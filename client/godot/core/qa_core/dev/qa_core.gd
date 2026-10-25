class_name QACore
extends RefCounted
## DEV build tools: the debug screen, commands, the automation channel, bot connection (headless run and real input),
## QAState, invariants, softlock and telemetry. The whole module is DEV code. Bot playtests, play agents, judge agents,
## completeness checks and the bot clients of an instance read QAState, the screen, the logs and telemetry through it
## and put input in.

## `mark` kinds.
enum MarkKind { FAIL, RESTART, GOAL, REWARD, RESPONSE }

const _TAG: String = "QACore"
const _MARK_NAMES: PackedStringArray = ["Fail", "Restart", "Goal", "Reward", "Response"]

const _NODE := preload("res://core/qa_core/dev/qa_core_node.gd")
const _COMMAND := preload("res://core/qa_core/dev/qa_command.gd")
const _BUILTINS := preload("res://core/qa_core/dev/qa_builtins.gd")
const _TELEMETRY := preload("res://core/qa_core/dev/qa_telemetry.gd")
const _CHANNEL := preload("res://core/qa_core/dev/qa_channel.gd")
const _INPUT := preload("res://core/qa_core/dev/qa_input.gd")
const _DEBUG := preload("res://core/qa_core/dev/qa_debug_screen.gd")
const _QUERY := preload("res://core/qa_core/dev/qa_query.gd")
const _JSON := preload("res://core/qa_core/dev/qa_json.gd")
const _ARGS := preload("res://core/qa_core/dev/qa_args.gd")
const _DRAW_WAIT := preload("res://core/qa_core/dev/qa_draw_wait.gd")

const _KEY_COMMAND_TIMEOUT: String = "QACore.commandTimeoutMs"
const _KEY_CHANNEL_MAX_BYTES: String = "QACore.channelMessageMaxBytes"
const _KEY_STATS_REFRESH: String = "QACore.statsRefreshMs"
const _KEY_TEXT_MAX_CHARS: String = "QACore.textMaxChars"
const _KEY_VIDEO_FPS: String = "QACore.videoFps"
const _KEY_VIDEO_MAX: String = "QACore.videoMaxMs"
const _KEY_CAPTURE_JPG_QUALITY: String = "QACore.captureJpgQuality"
const _KEY_FEEDBACK_WINDOW: String = "QACore.feedbackWindowMs"
const _KEY_IDLE_THRESHOLD: String = "QACore.idleThresholdMs"
const _KEY_TELEMETRY_MAX: String = "QACore.telemetryMaxRecords"
const _KEY_SOFTLOCK_BLOCK: String = "QACore.softlockBlockMs"
const _KEY_SOFTLOCK_NO_RESPONSE: String = "QACore.softlockNoResponseMs"
const _KEY_SOFTLOCK_INPUTS: String = "QACore.softlockNoResponseInputs"
const _KEY_STEP_MAX: String = "QACore.stepMaxMs"
const _KEY_TIME_SCALE_MAX: String = "QACore.timeScaleMaxPermille"
const _KEY_TOUCH_INDEX_COUNT: String = "QACore.touchIndexCount"
const _KEY_TEXT_SCALES: String = "AccessibilityCore.textScales"
const _KEY_BASE_RESOLUTION: String = "baseResolution"
const _KEY_UI_CHECK_SCREENS: String = "uiCheckScreens"
const _KEY_GAMEPAD_SUPPORTED: String = "gamepadSupported"
const _KEY_SUPPORTED_LANGUAGES: String = "supportedLanguages"
## Reason tags of `QACore.softlockBlockMs`: the block reasons that forced release does not cover.
const _SOFTLOCK_REASONS: PackedStringArray = ["scene", "cutscene", "tutorial", "ad", "boot"]
const _LAUNCH_PORT: String = "OGW_AUTOMATION_PORT"
const _LAUNCH_TOKEN: String = "OGW_AUTOMATION_TOKEN"
const _MAX_PORT: int = 65535
const _HEADLESS_DISPLAY: String = "headless"
## Reason text of the commands `release` ends.
const _RELEASED: String = "QACore was released"
## Reason text of the commands the end of their automation channel connection ends.
const _CHANNEL_ENDED: String = "the automation channel connection ended"
## Time scale of normal speed, permille: the time scale before TimeCore is initialized and the least
## `QACore.timeScaleMaxPermille`.
const _NORMAL_TIME_SCALE: int = 1000
## Reason tag of the timer hold of step mode.
const _STEP_HOLD_REASON: String = "step"
## Process frames a capture waits for a drawn frame before it draws one itself.
const _CAPTURE_DRAW_FRAMES: int = 2
## The least `QACore.captureJpgQuality`: the engine takes the JPEG quality in whole percents.
const _MIN_JPG_QUALITY: int = 10
## The largest `QACore.captureJpgQuality`, the permille of JPEG quality 1.
const _MAX_JPG_QUALITY: int = 1000

static var _is_initialized: bool = false
static var _node: _NODE = null
## Current `init`. A new object on every `init` and `release`; an async command of an older one stops.
static var _session: RefCounted = RefCounted.new()

static var _command_timeout_ms: int = 0
static var _channel_max_bytes: int = 0
static var _stats_refresh_ms: int = 0
static var _text_max_chars: int = 0
static var _video_fps: int = 0
static var _video_max_ms: int = 0
static var _capture_jpg_quality: int = 0
static var _softlock_no_response_ms: int = 0
static var _softlock_inputs: int = 0
static var _step_max_ms: int = 0
static var _time_scale_max_permille: int = 0
static var _touch_index_count: int = 0
static var _base_resolution: Vector2i = Vector2i.ZERO
## Softlock block elapsed time by reason tag.
static var _softlock_block_ms: Dictionary[String, int] = {}

## Commands waiting to start, in the order they came.
static var _queue: Array[_COMMAND] = []
## The command that runs now, and the `capture_video` that runs next to it.
static var _running: _COMMAND = null
static var _video: _COMMAND = null
static var _pump_scheduled: bool = false
static var _pump_call: Callable = Callable()
static var _frame_call: Callable = Callable()
static var _frame_scheduled: bool = false
## Device inputs of the input commands to put in at the start of the next frame, and the command of each: `null` for
## the releases of an automation channel disconnect.
static var _pending_inputs: Array[InputEvent] = []
static var _pending_commands: Array[_COMMAND] = []
## How many of the pending inputs, from the first, the frame start put in. The deferred frame start records them and
## takes them off.
static var _frame_input_count: int = 0
static var _frame_start_call: Callable = Callable()
## How many frame starts put their inputs in, and that count at the last `frame_started`. A command that waits for the
## frame start waits for a `frame_started` of a frame start after its wait began.
static var _frame_start_count: int = 0
static var _started_frame_count: int = 0
## Whether the `RealtimeCore.request_step` of a lockstep `step` has not returned yet.
static var _lockstep_step_running: bool = false

## Content commands by name, in registration order.
static var _content_names: PackedStringArray = PackedStringArray()
static var _content_descriptions: Dictionary[String, String] = {}
static var _content_args: Dictionary[String, PackedStringArray] = {}
static var _content_handlers: Dictionary[String, Callable] = {}
static var _content_state: Callable = Callable()
## Content command names and the content state callback whose destroyed object was logged once since registration.
static var _content_handler_logged: Dictionary[String, bool] = {}
static var _content_state_logged: bool = false
## Invariants by name, in registration order, and the names that gave `false`, in the order they first did.
static var _invariant_names: PackedStringArray = PackedStringArray()
static var _invariant_callbacks: Dictionary[String, Callable] = {}
static var _invariant_failures: PackedStringArray = PackedStringArray()

static var _telemetry: _TELEMETRY = _TELEMETRY.new()
## Telemetry time of the last state event and the inputs since it: the `NoResponse` softlock.
static var _last_state_time: int = 0
static var _inputs_since_state: int = 0
## Device inputs that input commands hold pressed.
static var _input: _INPUT = _INPUT.new()
static var _channel: _CHANNEL = null
static var _debug: _DEBUG = null
static var _stats_visible: bool = false
static var _debug_open: bool = false
## Real elapsed time of the last debug layer refresh.
static var _refreshed_real_ms: int = 0
## Last command result line of the debug screen.
static var _last_result_line: String = ""
## `duration_ms` of the last `SceneStartedEvent` and of `BootCompletedEvent`.
static var _last_scene_load_ms: int = 0
static var _boot_ms: int = 0
## Screen captures that hide the debug layer now.
static var _capture_hides: int = 0
## Core test state: launch values the next `init` reads instead of `BootstrapCoreDev.get_launch_value`.
static var _test_launch_values: Dictionary[String, String] = {}
static var _has_test_launch_values: bool = false


# --- lifecycle ---


## Reads the settings, makes the core node and the closed debug screen, starts the telemetry, subscribes the events
## and connects the automation channel.
static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not _read_settings():
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init: the main loop is not a SceneTree")
		return false
	if not EventCore.is_initialized() or not UICore.is_initialized() or not InputCore.is_initialized():
		LogCore.log_error(_TAG, "init: EventCore, UICore and InputCore must be initialized first")
		return false
	_session = RefCounted.new()
	var node: _NODE = _NODE.new()
	node.name = _TAG
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	_node = node
	_pump_call = _pump
	_frame_call = _on_deferred_frame
	_frame_start_call = _on_deferred_frame_start
	_is_initialized = true
	tree.root.add_child(node)
	tree.process_frame.connect(node.on_process_frame)
	_telemetry.start()
	_last_state_time = _telemetry.now()
	_refreshed_real_ms = TimeCore.get_real_time() if TimeCore.is_initialized() else 0
	if not node.subscribe_events(CameraCore.is_initialized()):
		LogCore.log_error(_TAG, "init: could not subscribe the telemetry events")
	InputCoreDev.set_debug_input_handler(node.on_debug_input)
	_debug = _DEBUG.new()
	_debug.build(UICore.get_layer(UICore.UILayer.DEBUG), node.on_debug_run)
	_connect_channel()
	return true


## Ends the waiting and running commands with `ok` = `false`, disconnects, and clears the registrations, the
## telemetry, the event subscriptions, the held input records and the debug screen.
static func release() -> void:
	if not _is_initialized:
		return
	var node: _NODE = _node
	_cleanup()
	if is_instance_valid(node):
		node.released = true
		if node.get_parent() != null:
			node.get_parent().remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## The core node left the tree outside `release`: the same cleanup without `remove_child`.
static func _on_node_exit(node: Node) -> void:
	if not _is_initialized or node != _node:
		return
	_cleanup()
	node.queue_free()


static func _cleanup() -> void:
	var node: _NODE = _node
	var commands: Array[_COMMAND] = _queue.duplicate()
	if _running != null:
		commands.append(_running)
	if _video != null:
		commands.append(_video)
	for command: _COMMAND in commands:
		_finish(command, false, _JSON.text(_RELEASED), PackedByteArray())
	if _channel != null:
		_channel.close()
	if is_instance_valid(node):
		node.unsubscribe_events()
		var tree: SceneTree = Engine.get_main_loop() as SceneTree
		if tree != null and tree.process_frame.is_connected(node.on_process_frame):
			tree.process_frame.disconnect(node.on_process_frame)
	if InputCore.is_initialized():
		InputCoreDev.set_debug_input_handler(Callable())
	if _debug != null:
		_debug.destroy()
	_is_initialized = false
	_node = null
	_session = RefCounted.new()
	_command_timeout_ms = 0
	_channel_max_bytes = 0
	_stats_refresh_ms = 0
	_text_max_chars = 0
	_video_fps = 0
	_video_max_ms = 0
	_capture_jpg_quality = 0
	_softlock_no_response_ms = 0
	_softlock_inputs = 0
	_step_max_ms = 0
	_time_scale_max_permille = 0
	_touch_index_count = 0
	_base_resolution = Vector2i.ZERO
	_softlock_block_ms = {}
	_queue = []
	_running = null
	_video = null
	_pump_scheduled = false
	_pump_call = Callable()
	_frame_call = Callable()
	_frame_scheduled = false
	_pending_inputs = []
	_pending_commands = []
	_frame_input_count = 0
	_frame_start_call = Callable()
	_frame_start_count = 0
	_started_frame_count = 0
	_lockstep_step_running = false
	_content_names = PackedStringArray()
	_content_descriptions = {}
	_content_args = {}
	_content_handlers = {}
	_content_state = Callable()
	_content_handler_logged = {}
	_content_state_logged = false
	_invariant_names = PackedStringArray()
	_invariant_callbacks = {}
	_invariant_failures = PackedStringArray()
	_telemetry = _TELEMETRY.new()
	_last_state_time = 0
	_inputs_since_state = 0
	_input = _INPUT.new()
	_channel = null
	_debug = null
	_stats_visible = false
	_debug_open = false
	_refreshed_real_ms = 0
	_last_result_line = ""
	_last_scene_load_ms = 0
	_boot_ms = 0
	_capture_hides = 0
	_test_launch_values = {}
	_has_test_launch_values = false
	# The commands waiting for a frame see the new session and stop.
	if is_instance_valid(node):
		node.frame_started.emit()
		node.frame_ended.emit()


# --- DEV operations ---


## Async. Runs one command after the commands before it and returns (`ok`, `result`, `bytes`).
static func run_command(command_name: String, args: PackedStringArray) -> RunCommandResult:
	var result: RunCommandResult = RunCommandResult.new()
	if not _check_initialized("run_command"):
		result.result = _JSON.text("QACore is not initialized")
		return result
	var command: _COMMAND = _submit(command_name, args, false, 0)
	if not command.done:
		await command.finished
	result.ok = command.ok
	result.result = command.result
	result.bytes = command.bytes
	return result


## Registers content command `command_name` (`<feature>.<command>`, both snake_case). `handler` is an async
## operation that takes the argument list and returns a `RunCommandResult`.
static func register_command(
		command_name: String, description: String, arg_names: PackedStringArray, handler: Callable
) -> bool:
	if not _check_initialized("register_command"):
		return false
	if not _is_feature_name(command_name):
		LogCore.log_error(_TAG, "register_command: the name is not <feature>.<command> in snake_case")
		return false
	if _content_handlers.has(command_name):
		LogCore.log_error(_TAG, "register_command: %s is registered already" % command_name)
		return false
	if not handler.is_valid():
		LogCore.log_error(_TAG, "register_command: the handler of %s cannot be called" % command_name)
		return false
	_content_names.append(command_name)
	_content_descriptions[command_name] = description
	_content_args[command_name] = arg_names.duplicate()
	_content_handlers[command_name] = handler
	return true


## Sets the callback whose JSON object text becomes `content` of QAState. `Callable()` clears it.
static func set_content_state(callback: Callable) -> void:
	if not _check_initialized("set_content_state"):
		return
	_content_state = callback
	_content_state_logged = false


## Records a telemetry mark of `kind`. `id_value` is the ID value of a `Reward` mark; 0 when there is none.
static func mark(kind: MarkKind, id_value: int = 0) -> void:
	if not _check_initialized("mark"):
		return
	if kind < 0 or kind >= _MARK_NAMES.size():
		LogCore.log_error(_TAG, "mark: %d is not a mark kind" % kind)
		return
	var time: int = _telemetry.now()
	_telemetry.add_mark(_MARK_NAMES[kind])
	if kind == MarkKind.REWARD:
		_telemetry.add_reward("Mark", id_value, 1)
	elif kind == MarkKind.GOAL:
		_telemetry.add_goal()
	if kind == MarkKind.RESPONSE:
		_telemetry.add_response(time)
	else:
		_telemetry.add_state_event(time)
	_on_state_event(time)


## Registers invariant `invariant_name` (`<feature>.<invariant>`, both snake_case). `callback` returns whether the
## invariant holds; it is called every frame.
static func register_invariant(invariant_name: String, callback: Callable) -> bool:
	if not _check_initialized("register_invariant"):
		return false
	if not _is_feature_name(invariant_name):
		LogCore.log_error(_TAG, "register_invariant: the name is not <feature>.<invariant> in snake_case")
		return false
	if _invariant_callbacks.has(invariant_name):
		LogCore.log_error(_TAG, "register_invariant: %s is registered already" % invariant_name)
		return false
	if not callback.is_valid():
		LogCore.log_error(_TAG, "register_invariant: the callback of %s cannot be called" % invariant_name)
		return false
	_invariant_names.append(invariant_name)
	_invariant_callbacks[invariant_name] = callback
	return true


## Whether this is a headless run. Works without `init`.
static func is_headless() -> bool:
	return DisplayServer.get_name() == _HEADLESS_DISPLAY


# --- commands ---


## Takes in a command. `capture_video` starts at once next to the queue; the others wait their turn.
static func _submit(command_name: String, args: PackedStringArray, from_channel: bool, request_id: int) -> _COMMAND:
	var command: _COMMAND = _COMMAND.new()
	command.name = command_name
	command.args = args.duplicate()
	command.from_channel = from_channel
	command.request_id = request_id
	command.session = _session
	if command_name == _BUILTINS.CAPTURE_VIDEO:
		if _video != null:
			_finish(command, false, _JSON.text("a capture_video runs already"), PackedByteArray())
			return command
		_video = command
		_start(command)
		return command
	_queue.append(command)
	_schedule_pump()
	return command


static func _schedule_pump() -> void:
	if _pump_scheduled or not _pump_call.is_valid():
		return
	_pump_scheduled = true
	_pump_call.call_deferred()


## Starts the next waiting command when none runs.
static func _pump() -> void:
	_pump_scheduled = false
	if not _is_initialized or _running != null or _queue.is_empty():
		return
	var command: _COMMAND = _queue[0]
	_queue.remove_at(0)
	_running = command
	_start(command)


static func _start(command: _COMMAND) -> void:
	command.started = true
	command.started_real_ms = TimeCore.get_real_time() if TimeCore.is_initialized() else 0
	var time_scale: int = TimeCore.get_time_scale() if TimeCore.is_initialized() else _NORMAL_TIME_SCALE
	command.limit_ms = _command_timeout_ms + _BUILTINS.extra_limit_ms(command.name, command.args, time_scale)
	_execute(command)


## Async. Checks the name and the argument count, then runs the command.
static func _execute(command: _COMMAND) -> void:
	if _content_handlers.has(command.name):
		var arg_names: PackedStringArray = _content_args[command.name]
		if command.args.size() != arg_names.size():
			_fail(command, "wrong argument count")
			return
		await _run_content(command)
		return
	if not _BUILTINS.has(command.name):
		_fail(command, "unknown command")
		return
	if not _BUILTINS.accepts_count(command.name, command.args.size()):
		_fail(command, "wrong argument count")
		return
	await _BUILTINS.run(command)


## Async. Runs a content command handler and takes its (`ok`, `result`).
# ogw:input_boundary
static func _run_content(command: _COMMAND) -> void:
	var handler: Callable = _content_handlers[command.name]
	if not handler.is_valid():
		if not _content_handler_logged.has(command.name):
			_content_handler_logged[command.name] = true
			LogCore.log_error(_TAG, "the handler of %s cannot be called: its object is destroyed" % command.name)
		_fail(command, "the handler cannot be called")
		return
	var value: Variant = await handler.call(command.args)
	if command.done:
		return
	if not value is RunCommandResult:
		_fail(command, "the handler did not return a result")
		return
	var result: RunCommandResult = value
	if not result.result.is_empty() and not _is_json(result.result):
		_fail(command, "the handler result is not JSON")
		return
	if result.ok:
		_finish(command, true, result.result, result.bytes)
		return
	if not result.result.is_empty():
		_finish(command, false, result.result, result.bytes)
		return
	_fail(command, "the handler failed")


## Ends `command` with `ok` = `false` and the English `reason` as `result`.
static func _fail(command: _COMMAND, reason: String) -> void:
	_finish(command, false, _JSON.text(reason), PackedByteArray())


## Ends `command` once: the logs, the response over the automation channel, then the next command.
static func _finish(command: _COMMAND, ok: bool, result: String, bytes: PackedByteArray) -> void:
	if command.done:
		return
	command.done = true
	command.ok = ok
	command.result = result
	command.bytes = bytes
	if command.session == _session:
		_clear_input_budget(command)
	if not ok and command.on_fail.is_valid() and command.session == _session:
		command.on_fail.call()
	if not ok:
		LogCore.log_warn(_TAG, "command %s failed: %s" % [command.name, _reason_of(result)])
	LogCore.log_info(_TAG, "command %s ok=%s" % [command.name, _JSON.boolean(ok)])
	_last_result_line = "%s ok=%s %s" % [command.name, _JSON.boolean(ok), result]
	if command.from_channel and _channel != null and command.session == _session:
		_send_response(command)
	if command == _running:
		_running = null
		_schedule_pump()
	if command == _video:
		_video = null
	_queue.erase(command)
	command.finished.emit()
	if ok and command.after.is_valid() and command.session == _session:
		command.after.call_deferred()


## Whether `text` is one JSON value.
# ogw:input_boundary
static func _is_json(text: String) -> bool:
	var parser: JSON = JSON.new()
	return parser.parse(text) == OK


## The English reason of a failed `result`: the JSON string, or the JSON text as it is.
# ogw:input_boundary
static func _reason_of(result: String) -> String:
	var value: Variant = JSON.parse_string(result) if not result.is_empty() else null
	if value is String:
		return value
	return result


## Ends a running command that went over its time limit.
static func _check_time_limits() -> void:
	if not TimeCore.is_initialized():
		return
	var now: int = TimeCore.get_real_time()
	if _running != null and _running.started and now - _running.started_real_ms >= _running.limit_ms:
		_fail(_running, "the command went over its time limit")
	if _video != null and _video.started and now - _video.started_real_ms >= _video.limit_ms:
		_fail(_video, "the command went over its time limit")


# --- frame ---


## Every frame from the core node: the heavy work runs deferred, outside frame code.
static func _on_frame() -> void:
	if not _is_initialized or _frame_scheduled or not _frame_call.is_valid():
		return
	_frame_scheduled = true
	_frame_call.call_deferred()


static func _on_deferred_frame() -> void:
	_frame_scheduled = false
	if not _is_initialized:
		return
	_telemetry.fold()
	_check_time_limits()
	_check_invariants()
	_poll_channel()
	_refresh_debug(false)
	if _is_initialized and is_instance_valid(_node):
		_node.frame_ended.emit()


## The start of a frame from the core node of `node`, frame code: puts in the device inputs that wait. The records of
## them and the commands that wait for the frame start go on deferred, in the flush right after `process_frame`, which
## still comes before the frame's process callbacks.
static func _on_frame_start(node: _NODE) -> void:
	if not _is_initialized or node != _node:
		return
	while _frame_input_count < _pending_inputs.size():
		if not _is_initialized or node != _node or not InputCore.is_initialized():
			return
		_add_input_budget(_pending_commands[_frame_input_count])
		InputCoreDev.inject_device_input(_pending_inputs[_frame_input_count])
		_frame_input_count += 1
	if _is_initialized and node == _node and _frame_start_call.is_valid():
		_frame_start_count += 1
		_frame_start_call.call_deferred()


## Frame code, right before a device input of input command `command` (`null` for none) goes in: in step mode with
## budget 0, game time not paused and no lockstep match playing, 1 ms of step budget, so the engine features run in the
## frame of the input.
static func _add_input_budget(command: _COMMAND) -> void:
	if command == null or not TimeCore.is_initialized() or not TimeCoreDev.is_step_mode():
		return
	if TimeCoreDev.get_step_budget() != 0 or TimeCore.is_paused() or _in_lockstep_play():
		return
	TimeCoreDev.add_step_budget(1)
	command.added_budget = true


## Whether the client is in `Playing` of a lockstep match, where only the steps of the match move game time.
static func _in_lockstep_play() -> bool:
	return RealtimeCore.is_initialized() and RealtimeCore.match_state() == RealtimeCore.MatchState.PLAYING \
		and RealtimeCore.match_info().lockstep


## A command that added input budget ended with budget left (a time scale too low to use it in the frame): turning step
## mode on again makes the budget 0, so a `step` after it starts from 0.
static func _clear_input_budget(command: _COMMAND) -> void:
	if not command.added_budget or not TimeCore.is_initialized() or not TimeCoreDev.is_step_mode():
		return
	if TimeCoreDev.get_step_budget() > 0:
		_set_step_mode(true)


## Records the device inputs the frame start put in and takes them off, then lets the commands that wait for the
## frame start go on.
static func _on_deferred_frame_start() -> void:
	if not _is_initialized or not is_instance_valid(_node):
		return
	var count: int = _frame_input_count
	for i: int in count:
		_note_input(_pending_commands[i])
		_input.apply(_pending_inputs[i])
	_pending_inputs = _pending_inputs.slice(count)
	_pending_commands = _pending_commands.slice(count)
	_frame_input_count = 0
	_started_frame_count = _frame_start_count
	_node.frame_started.emit()


## Puts `event` of input command `command` (`null` for none) in at the start of the next frame.
static func _put_input(command: _COMMAND, event: InputEvent) -> void:
	_pending_inputs.append(event)
	_pending_commands.append(command)


static func _check_invariants() -> void:
	for invariant_name: String in _invariant_names:
		if not _invariant_holds(_invariant_callbacks[invariant_name]) and not invariant_name in _invariant_failures:
			_invariant_failures.append(invariant_name)
			LogCore.log_error(_TAG, "invariant %s does not hold" % invariant_name)


# ogw:input_boundary
static func _invariant_holds(callback: Callable) -> bool:
	if not callback.is_valid():
		return false
	var value: Variant = callback.call()
	return value is bool and value == true


# --- automation channel ---


static func _connect_channel() -> void:
	var port_text: String = _launch_value(_LAUNCH_PORT)
	var token: String = _launch_value(_LAUNCH_TOKEN)
	if port_text.is_empty() or token.is_empty():
		return
	if not _ARGS.is_int(port_text) or _ARGS.to_int(port_text) < 1 or _ARGS.to_int(port_text) > _MAX_PORT:
		LogCore.log_error(_TAG, "could not connect the automation channel: the port is not a port number")
		return
	var channel: _CHANNEL = _CHANNEL.new()
	if not channel.open(_ARGS.to_int(port_text), token, _channel_max_bytes):
		LogCore.log_error(_TAG, "could not connect the automation channel")
		return
	_channel = channel


static func _launch_value(value_name: String) -> String:
	if _has_test_launch_values:
		return _test_launch_values.get(value_name, "")
	return BootstrapCoreDev.get_launch_value(value_name)


static func _poll_channel() -> void:
	if _channel == null:
		return
	var channel: _CHANNEL = _channel
	var messages: PackedStringArray = PackedStringArray()
	var status: _CHANNEL.Status = channel.poll(messages)
	for message: String in messages:
		if _channel != channel:
			return
		_on_channel_message(message)
	if status == _CHANNEL.Status.TOO_LONG:
		LogCore.log_warn(_TAG, "the automation channel got a message over the length limit; disconnected")
		_on_channel_closed(channel)
	elif status == _CHANNEL.Status.CLOSED:
		_on_channel_closed(channel)
	elif status == _CHANNEL.Status.NOT_CONNECTED:
		LogCore.log_error(_TAG, "could not connect the automation channel")
		channel.close()
		if _channel == channel:
			_channel = null


## The connection ended outside `release`: ends the commands it brought, then lets go of the inputs the input commands
## hold.
static func _on_channel_closed(channel: _CHANNEL) -> void:
	channel.close()
	if _channel != channel:
		return
	_channel = null
	var commands: Array[_COMMAND] = []
	if _running != null:
		commands.append(_running)
	if _video != null:
		commands.append(_video)
	commands.append_array(_queue)
	for command: _COMMAND in commands:
		if command.from_channel and command.session == _session:
			command.cut = true
			_fail(command, _CHANNEL_ENDED)
	var events: Array[InputEvent] = []
	var event_commands: Array[_COMMAND] = []
	for i: int in _pending_inputs.size():
		if i < _frame_input_count or _pending_commands[i] == null or not _pending_commands[i].cut:
			events.append(_pending_inputs[i])
			event_commands.append(_pending_commands[i])
	_pending_inputs = events
	_pending_commands = event_commands
	for event: InputEvent in _input.release_events():
		_put_input(null, event)


## One request of the automation channel.
# ogw:input_boundary
static func _on_channel_message(text: String) -> void:
	var parser: JSON = JSON.new()
	if parser.parse(text) != OK or not parser.data is Dictionary:
		_send_malformed(0)
		return
	var request: Dictionary = parser.data
	var id_value: Variant = request.get("id", null)
	var command_value: Variant = request.get("command", null)
	var args_value: Variant = request.get("args", null)
	if not _is_whole_number(id_value):
		_send_malformed(0)
		return
	var id_number: float = id_value
	var request_id: int = int(id_number)
	if not command_value is String or not args_value is Array:
		_send_malformed(request_id)
		return
	var args: PackedStringArray = PackedStringArray()
	var arg_list: Array = args_value
	for arg: Variant in arg_list:
		if not arg is String:
			_send_malformed(request_id)
			return
		var arg_text: String = arg
		args.append(arg_text)
	var command_name: String = command_value
	_submit(command_name, args, true, request_id)


static func _send_malformed(request_id: int) -> void:
	_channel_send(_JSON.object(PackedStringArray([
		_JSON.pair("id", _JSON.integer(request_id)),
		_JSON.pair("ok", _JSON.boolean(false)),
		_JSON.pair("result", _JSON.text("malformed request")),
		_JSON.pair("bytes", _JSON.text("")),
	])))


## The response of `command`. A response the channel cannot take is replaced by a short failed response of the same
## `id`, so the runner still gets one.
static func _send_response(command: _COMMAND) -> void:
	var sent: bool = _channel_send(_JSON.object(PackedStringArray([
		_JSON.pair("id", _JSON.integer(command.request_id)),
		_JSON.pair("ok", _JSON.boolean(command.ok)),
		_JSON.pair("result", command.result if not command.result.is_empty() else _JSON.NULL),
		_JSON.pair("bytes", _JSON.text(Marshalls.raw_to_base64(command.bytes) if not command.bytes.is_empty() else "")),
	])))
	if sent or not _has_channel():
		return
	LogCore.log_warn(_TAG, "the response of command %s could not be sent" % command.name)
	_channel_send(_JSON.object(PackedStringArray([
		_JSON.pair("id", _JSON.integer(command.request_id)),
		_JSON.pair("ok", _JSON.boolean(false)),
		_JSON.pair("result", _JSON.text("the response could not be sent")),
		_JSON.pair("bytes", _JSON.text("")),
	])))


## One `capture_video` frame message.
static func _send_frame(command: _COMMAND, frame: int, image: PackedByteArray) -> bool:
	if _channel == null or command.session != _session:
		return false
	return _channel_send(_JSON.object(PackedStringArray([
		_JSON.pair("id", _JSON.integer(command.request_id)),
		_JSON.pair("frame", _JSON.integer(frame)),
		_JSON.pair("bytes", _JSON.text(Marshalls.raw_to_base64(image))),
	])))


static func _channel_send(text: String) -> bool:
	if _channel == null:
		return false
	return _channel.send(text)


static func _has_channel() -> bool:
	return _channel != null and _channel.is_open()


# --- events ---


## A device input of an input command: the first one records the telemetry input.
static func _note_input(command: _COMMAND) -> void:
	if command == null or command.input_recorded:
		return
	command.input_recorded = true
	_telemetry.add_input(command.name)
	_inputs_since_state += 1


static func _on_feedback(kind: _TELEMETRY.Feedback) -> void:
	var time: int = _telemetry.now()
	_telemetry.add_feedback(kind)
	_on_state_event(time)


static func _on_response_event() -> void:
	var time: int = _telemetry.now()
	_telemetry.add_response(time)
	_on_state_event(time)


static func _on_state_only_event() -> void:
	var time: int = _telemetry.now()
	_telemetry.add_state_event(time)
	_on_state_event(time)


static func _on_state_event(time: int) -> void:
	_last_state_time = time
	_inputs_since_state = 0


static func _on_scene_started(scene_key: String, duration_ms: int) -> void:
	_last_scene_load_ms = duration_ms
	_telemetry.add_scene_load(scene_key, duration_ms)
	_on_state_only_event()


static func _on_item_changes(changes: Array[CoreContract.ItemChange]) -> void:
	for change: CoreContract.ItemChange in changes:
		if change == null:
			continue
		if change.source == CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_CHEAT \
				or change.source == CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_PLAY_SESSION_REFUND:
			continue
		var amount: int = change.delta
		if not change.big_delta.is_empty():
			if change.big_delta.begins_with("-") or not _ARGS.is_big_count(change.big_delta):
				continue
			amount = _ARGS.MAX_SAFE_INTEGER if not _ARGS.is_safe_integer(change.big_delta) else change.big_delta.to_int()
		if amount < 1:
			continue
		_telemetry.add_reward("Item", change.item_id, mini(amount, _ARGS.MAX_SAFE_INTEGER))


# --- debug screen ---


## The debug input handler: `F12` or four touches at once open and close the debug screen.
static func _on_debug_input(event: InputEvent) -> bool:
	if not _is_initialized:
		return false
	var action: _INPUT.DebugInput = _input.debug_input(event)
	if action == _INPUT.DebugInput.TOGGLE:
		_set_debug_open(not _debug_open)
		return true
	return action == _INPUT.DebugInput.CONSUME


static func _set_debug_open(open: bool) -> void:
	if open == _debug_open:
		return
	_debug_open = open
	if open and InputCore.is_initialized():
		InputCore.cancel_input()
	if _debug != null:
		_debug.set_screen_visible(open)
	_refresh_debug(true)


static func _set_stats_visible(visible: bool) -> void:
	_stats_visible = visible
	if _debug != null:
		_debug.set_stats_visible(visible)
	_refresh_debug(true)


## Refreshes the debug layer every `QACore.statsRefreshMs`, or now with `force`.
static func _refresh_debug(force: bool) -> void:
	if _debug == null or (not _stats_visible and not _debug_open):
		return
	var now: int = TimeCore.get_real_time() if TimeCore.is_initialized() else 0
	if not force and now - _refreshed_real_ms < _stats_refresh_ms:
		return
	_refreshed_real_ms = now
	if _stats_visible:
		_debug.set_stats_text(_QUERY.stats_text())
	if _debug_open:
		_debug.set_screen_text(_QUERY.state_json(), _last_result_line, _BUILTINS.command_lines())


## A command line typed on the debug screen: the name, then the arguments separated by spaces.
static func _on_debug_run(line: String) -> void:
	var parts: PackedStringArray = line.strip_edges().split(" ", false)
	if parts.is_empty():
		return
	var args: PackedStringArray = parts.slice(1)
	var command: _COMMAND = _submit(parts[0], args, false, 0)
	if not command.done:
		await command.finished
	_refresh_debug(true)


# --- QAState ---


## `content` of QAState: the JSON object text of the content state callback, `{}` when there is none. A callback that
## throws or gives no JSON object text gives `{}` and one error log for the callback.
# ogw:input_boundary
static func _content_json() -> String:
	if _content_state.is_null():
		return "{}"
	if not _content_state.is_valid():
		_log_content_state("the content state callback cannot be called: its object is destroyed")
		return "{}"
	var value: Variant = _content_state.call()
	if not value is String:
		_log_content_state("the content state callback did not give JSON object text")
		return "{}"
	var text: String = value
	var parser: JSON = JSON.new()
	if parser.parse(text) != OK or not parser.data is Dictionary:
		_log_content_state("the content state callback did not give JSON object text")
		return "{}"
	return text


## The error log of the content state callback: once a callback.
static func _log_content_state(message: String) -> void:
	if _content_state_logged:
		return
	_content_state_logged = true
	LogCore.log_error(_TAG, message)


## `softlock` of QAState: `null`, a `Block` or a `NoResponse` object.
static func _softlock_json() -> String:
	if TimeCore.is_initialized() and TimeCoreDev.is_step_mode():
		return _JSON.NULL
	if InputBlockCore.is_initialized():
		var blocks: Array[ActiveBlockInfo] = []
		blocks.resize(InputBlockCoreDev.count_active())
		var count: int = InputBlockCoreDev.list_active(blocks)
		for i: int in count:
			var block: ActiveBlockInfo = blocks[i]
			if _softlock_block_ms.has(block.reason) and block.elapsed_ms >= _softlock_block_ms[block.reason]:
				return _JSON.object(PackedStringArray([
					_JSON.pair("kind", _JSON.text("Block")),
					_JSON.pair("reason", _JSON.text(block.reason)),
					_JSON.pair("elapsed_ms", _JSON.integer(block.elapsed_ms)),
				]))
	var elapsed: int = _telemetry.now() - _last_state_time
	if elapsed >= _softlock_no_response_ms and _inputs_since_state >= _softlock_inputs:
		return _JSON.object(PackedStringArray([
			_JSON.pair("kind", _JSON.text("NoResponse")),
			_JSON.pair("elapsed_ms", _JSON.integer(elapsed)),
		]))
	return _JSON.NULL


# --- after the response ---


## `RestartRequestedEvent` from QACore, after the response of `set_language` or `restart`.
static func _publish_restart() -> void:
	if not EventCore.is_initialized():
		return
	var event: RestartRequestedEvent = EventCore.acquire(RestartRequestedEvent) as RestartRequestedEvent
	if event == null:
		return
	event.module = _TAG
	EventCore.publish(event)


## The app exit an OS exit request makes, after the response of `quit`.
static func _request_quit() -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		return
	tree.root.propagate_notification(Node.NOTIFICATION_WM_CLOSE_REQUEST)
	if tree.auto_accept_quit:
		tree.quit()


# --- screen capture ---


## Async. PNG, or JPEG of quality `QACore.captureJpgQuality` with `jpg`, of the root viewport in a frame drawn without
## the debug layer. Empty on failure.
static func _capture_image(jpg: bool) -> PackedByteArray:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null or is_headless():
		return PackedByteArray()
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.DEBUG) if UICore.is_initialized() else null
	var session: RefCounted = _session
	_capture_hides += 1
	if layer != null:
		layer.visible = false
	await _drawn_frame(tree)
	var image: Image = tree.root.get_texture().get_image() if session == _session else null
	if session == _session:
		_capture_hides -= 1
		if _capture_hides == 0 and is_instance_valid(layer):
			layer.visible = true
	elif is_instance_valid(layer):
		layer.visible = true
	if image == null:
		return PackedByteArray()
	# The image is the size of the window of the automation coordinates, the test window under `set_test_screen`.
	var window: Vector2i = ResolutionCore.get_window_size() if ResolutionCore.is_initialized() else image.get_size()
	if window.x >= 1 and window.y >= 1 and image.get_size() != window:
		image.resize(window.x, window.y)
	if jpg:
		return image.save_jpg_to_buffer(float(_capture_jpg_quality) / float(_MAX_JPG_QUALITY))
	return image.save_png_to_buffer()


## Async. Ends after a frame drawn from now. When the engine draws none in `_CAPTURE_DRAW_FRAMES` process frames (a
## window it does not draw, such as one other windows cover), draws one frame itself.
static func _drawn_frame(tree: SceneTree) -> void:
	var wait: _DRAW_WAIT = _DRAW_WAIT.new()
	RenderingServer.frame_post_draw.connect(wait.on_drawn)
	var frames: int = 0
	while not wait.drawn and frames < _CAPTURE_DRAW_FRAMES:
		await tree.process_frame
		frames += 1
	RenderingServer.frame_post_draw.disconnect(wait.on_drawn)
	if not wait.drawn:
		RenderingServer.force_draw()


# --- step mode ---


static func _set_step_mode(on: bool) -> void:
	_telemetry.fold()
	TimeCoreDev.set_step_mode(on)
	_telemetry.fold()
	if InputBlockCore.is_initialized():
		InputBlockCore.set_timer_hold(_STEP_HOLD_REASON, on)


# --- settings ---


static func _read_settings() -> bool:
	# The least value of each integer setting.
	var int_keys: Dictionary[String, int] = {
		_KEY_COMMAND_TIMEOUT: 1, _KEY_CHANNEL_MAX_BYTES: 1, _KEY_STATS_REFRESH: 1, _KEY_TEXT_MAX_CHARS: 1,
		_KEY_VIDEO_FPS: 1, _KEY_VIDEO_MAX: 1, _KEY_CAPTURE_JPG_QUALITY: _MIN_JPG_QUALITY,
		_KEY_FEEDBACK_WINDOW: 0, _KEY_IDLE_THRESHOLD: 0, _KEY_TELEMETRY_MAX: 0, _KEY_SOFTLOCK_NO_RESPONSE: 0,
		_KEY_SOFTLOCK_INPUTS: 1, _KEY_STEP_MAX: 1, _KEY_TIME_SCALE_MAX: _NORMAL_TIME_SCALE, _KEY_TOUCH_INDEX_COUNT: 1,
	}
	for key: String in int_keys:
		if not CoreSettings.has_int(key) or CoreSettings.get_int(key) < int_keys[key]:
			LogCore.log_error(_TAG, "init: setting %s is missing or not an integer of at least %d" % [key, int_keys[key]])
			return false
	if CoreSettings.get_int(_KEY_CAPTURE_JPG_QUALITY) > _MAX_JPG_QUALITY:
		LogCore.log_error(_TAG, "init: setting %s is over %d" % [_KEY_CAPTURE_JPG_QUALITY, _MAX_JPG_QUALITY])
		return false
	for key: String in [_KEY_TEXT_SCALES, _KEY_UI_CHECK_SCREENS, _KEY_SUPPORTED_LANGUAGES]:
		if not _is_array_setting(key):
			LogCore.log_error(_TAG, "init: setting %s is missing or not an array" % key)
			return false
	if not CoreSettings.has_bool(_KEY_GAMEPAD_SUPPORTED):
		LogCore.log_error(_TAG, "init: setting %s is missing or not a boolean" % _KEY_GAMEPAD_SUPPORTED)
		return false
	var base: PackedInt64Array = CoreSettings.get_int_array(_KEY_BASE_RESOLUTION)
	if base.size() != 2 or base[0] < 1 or base[1] < 1:
		LogCore.log_error(_TAG, "init: setting %s is missing or not 2 integers of at least 1" % _KEY_BASE_RESOLUTION)
		return false
	var block_ms: Dictionary[String, int] = {}
	if not _read_softlock_block_ms(block_ms):
		LogCore.log_error(_TAG, "init: setting %s is missing or not an integer for each of %s" % [
			_KEY_SOFTLOCK_BLOCK, ", ".join(_SOFTLOCK_REASONS)])
		return false
	_command_timeout_ms = CoreSettings.get_int(_KEY_COMMAND_TIMEOUT)
	_channel_max_bytes = CoreSettings.get_int(_KEY_CHANNEL_MAX_BYTES)
	_stats_refresh_ms = CoreSettings.get_int(_KEY_STATS_REFRESH)
	_text_max_chars = CoreSettings.get_int(_KEY_TEXT_MAX_CHARS)
	_video_fps = CoreSettings.get_int(_KEY_VIDEO_FPS)
	_video_max_ms = CoreSettings.get_int(_KEY_VIDEO_MAX)
	_capture_jpg_quality = CoreSettings.get_int(_KEY_CAPTURE_JPG_QUALITY)
	_softlock_no_response_ms = CoreSettings.get_int(_KEY_SOFTLOCK_NO_RESPONSE)
	_softlock_inputs = CoreSettings.get_int(_KEY_SOFTLOCK_INPUTS)
	_step_max_ms = CoreSettings.get_int(_KEY_STEP_MAX)
	_time_scale_max_permille = CoreSettings.get_int(_KEY_TIME_SCALE_MAX)
	_touch_index_count = CoreSettings.get_int(_KEY_TOUCH_INDEX_COUNT)
	_base_resolution = Vector2i(base[0], base[1])
	_softlock_block_ms = block_ms
	_telemetry.feedback_window_ms = CoreSettings.get_int(_KEY_FEEDBACK_WINDOW)
	_telemetry.idle_threshold_ms = CoreSettings.get_int(_KEY_IDLE_THRESHOLD)
	_telemetry.max_records = maxi(CoreSettings.get_int(_KEY_TELEMETRY_MAX), 1)
	return true


# ogw:input_boundary
static func _is_array_setting(key: String) -> bool:
	var value: Variant = JSON.parse_string(CoreSettings.get_json(key))
	return value is Array


## Reads `QACore.softlockBlockMs` into `out`: a non-negative integer for each reason tag of `_SOFTLOCK_REASONS`.
# ogw:input_boundary
static func _read_softlock_block_ms(out: Dictionary[String, int]) -> bool:
	var value: Variant = JSON.parse_string(CoreSettings.get_json(_KEY_SOFTLOCK_BLOCK))
	if not value is Dictionary:
		return false
	var map: Dictionary = value
	for reason: String in _SOFTLOCK_REASONS:
		var item: Variant = map.get(reason, null)
		if not _is_whole_number(item):
			return false
		var number: float = item
		if number < 0.0:
			return false
		out[reason] = int(number)
	return true


# --- helpers ---


## Whether `value` is a JSON number with no fraction.
# ogw:input_boundary
static func _is_whole_number(value: Variant) -> bool:
	if value is int:
		return true
	if not value is float:
		return false
	var number: float = value
	return is_finite(number) and floorf(number) == number


## `<feature>.<name>` with both parts in snake_case.
static func _is_feature_name(text: String) -> bool:
	var parts: PackedStringArray = text.split(".")
	return parts.size() == 2 and UtilCore.is_snake_case(parts[0]) and UtilCore.is_snake_case(parts[1])


static func _check_initialized(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, "%s called before init" % operation)
	return false
