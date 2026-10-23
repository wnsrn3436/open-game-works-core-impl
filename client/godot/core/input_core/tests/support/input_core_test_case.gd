class_name InputCoreTestCase
extends UnitTestCase
## Base of the InputCore core tests. Before each test: InputCore settings as test settings, the test actions in the
## input map, the modules InputCore depends on and InputCore initialized in module list order, a 1920x1080
## `Letterbox` test screen (game coordinates are window pixels), and a recorder subscribed to every InputCore event.
## After each test: the modules released, the input map back to the project settings, and the test nodes freed.

const TAG: String = "InputCore"
const MOVE_THRESHOLD: float = 10.0
const LONG_PRESS_MS: int = 500
const SWIPE_MAX_MS: int = 300
const SWIPE_MIN_DISTANCE: float = 100.0
const MAX_JUDGE_POINTERS: int = 4
const MAX_KEYS_PER_ACTION: int = 3
const MAX_PAD_BUTTONS_PER_ACTION: int = 3
const PAD_AXIS_WAIT_THRESHOLD: float = 0.5
const PAD_AXIS_DEADZONE: float = 0.2
## A point of the visible game area away from the top left corner, where the test runner draws its GUI.
const CENTER: Vector2 = Vector2(1200.0, 600.0)
## `key_result` and `pad_result` while the wait has not ended.
const PENDING: String = "<pending>"

var recorder: InputCoreTestRecorder = null
## Result of the `wait_key` that `start_wait_key` started.
var key_result: String = PENDING
## Result of the `wait_pad_button` that `start_wait_pad_button` started.
var pad_result: String = PENDING
var _nodes: Array[Node] = []
var _probe: _ProcessProbe = null


## A node whose process callback comes after the one of the InputCore core node.
class _ProcessProbe:
	extends Node

	signal processed

	func _init() -> void:
		process_mode = Node.PROCESS_MODE_ALWAYS

	func _process(_delta: float) -> void:
		processed.emit()


func before_each() -> void:
	super()
	set_input_settings()
	add_test_actions()
	get_viewport().gui_release_focus()
	assert_true(init_modules(), "modules init")
	recorder = InputCoreTestRecorder.new()
	_nodes.append(recorder)
	assert_true(recorder.subscribe_all(), "recorder subscribes")


func after_each() -> void:
	super()
	if EventCore.is_initialized() and is_instance_valid(recorder):
		EventCore.unsubscribe_all(recorder)
	release_modules()
	InputMap.load_from_project_settings()
	for node: Node in _nodes:
		if is_instance_valid(node):
			node.free()
	_nodes.clear()
	# a test that ended in `input_frame` runs in the probe's signal emission, which keeps the probe from `free`
	if is_instance_valid(_probe):
		_probe.queue_free()
	_probe = null
	recorder = null


## InputCore settings as test settings. Call before `InputCore.init`.
func set_input_settings() -> void:
	assert_true(UnitTestCore.set_test_settings("InputCore.moveThreshold", MOVE_THRESHOLD))
	assert_true(UnitTestCore.set_test_settings("InputCore.longPressMs", LONG_PRESS_MS))
	assert_true(UnitTestCore.set_test_settings("InputCore.swipeMaxMs", SWIPE_MAX_MS))
	assert_true(UnitTestCore.set_test_settings("InputCore.swipeMinDistance", SWIPE_MIN_DISTANCE))
	assert_true(UnitTestCore.set_test_settings("InputCore.maxJudgePointers", MAX_JUDGE_POINTERS))
	assert_true(UnitTestCore.set_test_settings("InputCore.maxKeysPerAction", MAX_KEYS_PER_ACTION))
	assert_true(UnitTestCore.set_test_settings("InputCore.maxPadButtonsPerAction", MAX_PAD_BUTTONS_PER_ACTION))
	assert_true(UnitTestCore.set_test_settings("InputCore.padAxisWaitThreshold", PAD_AXIS_WAIT_THRESHOLD))
	assert_true(UnitTestCore.set_test_settings("InputCore.padAxisDeadzone", PAD_AXIS_DEADZONE))


## Test actions besides the core actions `back` (Escape, `b`), `cutscene_advance` (Space, Enter, `a`) and
## `cutscene_skip` (Tab, `start`).
func add_test_actions() -> void:
	add_action(&"jump", [key_event(KEY_J), pad_button_event(JOY_BUTTON_B)])
	add_action(&"move_left", [key_event(KEY_A), pad_axis_event(JOY_AXIS_LEFT_X, -1.0)])
	add_action(&"move_right", [key_event(KEY_D), pad_axis_event(JOY_AXIS_LEFT_X, 1.0)])
	add_action(&"move_up", [key_event(KEY_W), pad_axis_event(JOY_AXIS_LEFT_Y, -1.0)])
	add_action(&"move_down", [key_event(KEY_S), pad_axis_event(JOY_AXIS_LEFT_Y, 1.0)])
	add_action(&"fire", [key_event(KEY_F), pad_axis_event(JOY_AXIS_TRIGGER_RIGHT, 1.0)])
	add_action(&"menu_ok", [key_event(KEY_K), pad_button_event(JOY_BUTTON_X)])


## Adds `action` with `events` as its default binding to the input map. Call before `InputCore.init`.
func add_action(action: StringName, events: Array[InputEvent]) -> void:
	if InputMap.has_action(action):
		InputMap.erase_action(action)
	InputMap.add_action(action)
	for event: InputEvent in events:
		InputMap.action_add_event(action, event)


func init_modules() -> bool:
	var ok: bool = LogCore.init()
	ok = EventCore.init() and ok
	ok = TimeCore.init() and ok
	ok = LocalDataCore.init() and ok
	ok = LocalDataCore.load_device_file() and ok
	ResourceCoreDev.set_test_key_list({})
	ok = ResourceCore.init() and ok
	ok = DataCore.init() and ok
	ok = ResolutionCore.init() and ok
	set_screen(Vector2i(1920, 1080), Vector2i(1920, 1080))
	ok = InputBlockCore.init() and ok
	ok = InputCore.init() and ok
	return ok


func release_modules() -> void:
	InputCore.release()
	InputBlockCore.release()
	ResolutionCore.release()
	DataCore.release()
	ResourceCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()


## `release` and `init` of InputCore, as when the input map changed.
func restart_input_core() -> bool:
	InputCore.release()
	return InputCore.init()


## A `Letterbox` test screen of `base` resolution and `window` size.
func set_screen(base: Vector2i, window: Vector2i) -> void:
	ResolutionCoreDev.set_test_screen(base, window, ResolutionCore.FillMode.LETTERBOX, true)


# --- input


static func key_event(code: Key, pressed: bool = false, echo: bool = false) -> InputEventKey:
	var event: InputEventKey = InputEventKey.new()
	event.keycode = code
	event.pressed = pressed
	event.echo = echo
	return event


static func pad_button_event(button: JoyButton, pressed: bool = false) -> InputEventJoypadButton:
	var event: InputEventJoypadButton = InputEventJoypadButton.new()
	event.button_index = button
	event.pressed = pressed
	return event


static func pad_axis_event(axis: JoyAxis, value: float) -> InputEventJoypadMotion:
	var event: InputEventJoypadMotion = InputEventJoypadMotion.new()
	event.axis = axis
	event.axis_value = value
	return event


static func mouse_button_event(button: MouseButton, pressed: bool = false) -> InputEventMouseButton:
	var event: InputEventMouseButton = InputEventMouseButton.new()
	event.button_index = button
	event.pressed = pressed
	return event


func key(code: Key, pressed: bool, echo: bool = false) -> void:
	InputCoreDev.inject_device_input(key_event(code, pressed, echo))


## A key press and its release.
func press_key(code: Key) -> void:
	key(code, true)
	key(code, false)


func pad_button(button: JoyButton, pressed: bool) -> void:
	InputCoreDev.inject_device_input(pad_button_event(button, pressed))


func pad_axis(axis: JoyAxis, value: float) -> void:
	InputCoreDev.inject_device_input(pad_axis_event(axis, value))


func mouse_button(button: MouseButton, pressed: bool, position: Vector2 = CENTER) -> void:
	var event: InputEventMouseButton = mouse_button_event(button, pressed)
	event.position = position
	InputCoreDev.inject_device_input(event)


func mouse_move(position: Vector2) -> void:
	var event: InputEventMouseMotion = InputEventMouseMotion.new()
	event.position = position
	InputCoreDev.inject_device_input(event)


func touch(index: int, pressed: bool, position: Vector2) -> void:
	var event: InputEventScreenTouch = InputEventScreenTouch.new()
	event.index = index
	event.pressed = pressed
	event.position = position
	InputCoreDev.inject_device_input(event)


func drag(index: int, position: Vector2) -> void:
	var event: InputEventScreenDrag = InputEventScreenDrag.new()
	event.index = index
	event.position = position
	InputCoreDev.inject_device_input(event)


## Real window pixel position of `game`, as an engine input event carries it before the root viewport transform. The
## headless window is smaller than the test screen, so it is not `game_to_window`.
func to_window(game: Vector2) -> Vector2:
	return ResolutionCore.game_to_window(game) / InputCore._real_to_window_scale()


## Root viewport position of `game`, where a `Control` under the root is drawn.
func to_viewport(game: Vector2) -> Vector2:
	return get_viewport().get_screen_transform().affine_inverse() * to_window(game)


## A button on `rect` (game coordinates) under the root, freed after the test.
func make_button(rect: Rect2) -> Button:
	var button: Button = Button.new()
	var top_left: Vector2 = to_viewport(rect.position)
	button.position = top_left
	button.custom_minimum_size = Vector2.ZERO
	button.size = to_viewport(rect.end) - top_left
	get_tree().root.add_child(button)
	_nodes.append(button)
	return button


## A control on `rect` (game coordinates) under the root that counts its GUI input, freed after the test.
func make_control(rect: Rect2) -> InputCoreTestControl:
	var control: InputCoreTestControl = InputCoreTestControl.new()
	var top_left: Vector2 = to_viewport(rect.position)
	control.position = top_left
	control.size = to_viewport(rect.end) - top_left
	get_tree().root.add_child(control)
	_nodes.append(control)
	return control


## Starts `wait_key`; `key_result` gets its result when it ends. Call without `await`.
func start_wait_key() -> void:
	key_result = PENDING
	key_result = await InputCore.wait_key()


## Starts `wait_pad_button`; `pad_result` gets its result when it ends. Call without `await`.
func start_wait_pad_button() -> void:
	pad_result = PENDING
	pad_result = await InputCore.wait_pad_button()


## A node freed after the test.
func keep(node: Node) -> Node:
	_nodes.append(node)
	return node


# --- block


## A `content` block whose pass list has `actions` and `elements`.
func block_with(actions: Array[StringName], elements: Array[Control]) -> int:
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.actions = actions
	pass_list.elements = elements
	var token: int = InputBlockCore.block("content", pass_list)
	assert_true(InputBlockCore.is_active(token), "block is active")
	return token


## A `content` block without a pass list.
func block_all() -> int:
	var token: int = InputBlockCore.block("content")
	assert_true(InputBlockCore.is_active(token), "block is active")
	return token


func unblock(token: int) -> void:
	assert_true(InputBlockCore.unblock(token), "unblock")


# --- logs, frames and clock


## Unconfirmed `error` logs of InputCore, which this confirms.
func errors() -> int:
	return UnitTestCore.check_logs("error", TAG)


## Unconfirmed `warn` logs of InputCore, which this confirms.
func warns() -> int:
	return UnitTestCore.check_logs("warn", TAG)


## The process step of the frame after the one current at the call. The engine raises the frame number at the end of a
## frame's process step, so a test that runs before that step (as the first test of a browser run does, at frame 0)
## waits two process steps: input injected there belongs to the frame of the first one.
func next_frame() -> void:
	var frame: int = Engine.get_process_frames()
	await UnitTestCore.wait_frames(1)
	if Engine.get_process_frames() == frame:
		await UnitTestCore.wait_frames(1)


## The first process callbacks after the device inputs injected before the call: it returns in a process callback
## after InputCore stamped their pressed and released frames.
func input_frame() -> void:
	if not is_instance_valid(_probe):
		_probe = _ProcessProbe.new()
		get_tree().root.add_child(_probe)
	await _probe.processed
	while InputCore._frames_pending:
		await _probe.processed


## Two frames, so that the core node's frame check (block start check, long press) ran at least once.
func run_frame_checks() -> void:
	await UnitTestCore.wait_frames(2)


## Moves the test clock by `ms` in the foreground.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
