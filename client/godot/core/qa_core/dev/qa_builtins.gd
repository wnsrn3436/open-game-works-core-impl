extends RefCounted
## Built-in commands of `QACore`: their names, argument names and descriptions, the argument checks and the work.
## A command that fails a check calls no target operation. Positions in arguments are window pixels.

const _COMMAND := preload("res://core/qa_core/dev/qa_command.gd")
const _JSON := preload("res://core/qa_core/dev/qa_json.gd")
const _ARGS := preload("res://core/qa_core/dev/qa_args.gd")
const _INPUT := preload("res://core/qa_core/dev/qa_input.gd")
const _QUERY := preload("res://core/qa_core/dev/qa_query.gd")
const _NODE := preload("res://core/qa_core/dev/qa_core_node.gd")

const CAPTURE_VIDEO: String = "capture_video"
## Room for the request records of `get_requests` and the records of `get_sound`.
const _RECORD_ROOM: int = 65536
## The largest integer a JSON number keeps exactly: 2^53.
const _MAX_EXACT_INT: float = 9007199254740992.0
const _SOUND_ROOM: int = 4096
const _ITEM_KIND: String = "item"
const _SINGLE_ITEM: String = "[]"
const _ON: String = "on"
const _OFF: String = "off"
const _NONE: String = "none"
const _TRUE: String = "true"
const _FALSE: String = "false"
const _OTHER: String = "other"
const _MS_PER_S: int = 1000
const _REPLACEMENT_CHARACTER: int = 0xFFFD
const _FILL_MODES: PackedStringArray = ["Crop", "Letterbox"]
const _INPUT_DEVICES: PackedStringArray = ["Touch", "KeyboardMouse", "Gamepad"]
const _PUSH_PERMISSIONS: PackedStringArray = ["Undetermined", "Granted", "Denied", "Unsupported"]

## Built-in commands: `<name>|<argument names>|<description>`. A `?` suffix marks an argument that can be left out.
const _SPECS: PackedStringArray = [
	"get_state||Reads QAState.",
	"get_stats||Reads the performance stats.",
	"get_telemetry||Reads the telemetry.",
	"clear_telemetry||Empties the telemetry and starts it now.",
	"capture_screen||PNG of the screen without the debug layer.",
	"capture_video|ms|PNG frames of the screen over the automation channel.",
	"list_ui||Reads the visible UI elements.",
	"get_anchor|anchor,key?|Reads the rectangle of an anchor.",
	"tap|x,y|Touch press and release.",
	"tap_anchor|anchor,key?|Tap at the center of a visible anchor.",
	"drag|x1,y1,x2,y2,ms|Touch press, move and release.",
	"key|key,ms?|Key press, release after ms.",
	"text|text|Text input, one character a frame.",
	"touch_down|index,x,y|Touch press.",
	"touch_move|index,x,y|Touch move.",
	"touch_up|index|Touch release.",
	"key_down|key|Key press.",
	"key_up|key|Key release.",
	"mouse_move|x,y|Mouse move.",
	"mouse_down|button,x,y|Mouse move and button press.",
	"mouse_up|button,x,y|Mouse move and button release.",
	"pad_button_down|button|Gamepad button press.",
	"pad_button_up|button|Gamepad button release.",
	"pad_axis|axis,value|Gamepad axis value.",
	"go_to_scene|scene|Changes the scene.",
	"open_panel|panel|Opens a panel.",
	"set_time_scale|permille|Sets the time scale.",
	"set_step_mode|mode|Turns step mode on or off.",
	"leave_match||Leaves the realtime match.",
	"step|ms|Moves the game time in step mode.",
	"set_language|code|Selects a language and restarts.",
	"set_server_time_offset|ms|Sets the cheat server time offset.",
	"set_user_state|kind,item,value|Replaces a UserState entry.",
	"set_item_balance|item,balance|Sets an item balance.",
	"delete_user_state|kind,item|Deletes a UserState entry.",
	"set_mission_progress|mission,progress,claimed|Sets a mission progress.",
	"set_reset_counter|counter,count|Sets a reset counter.",
	"set_quality_level|level|Sets the quality level.",
	"set_text_scale|permille|Sets the text scale.",
	"force_network_failure|kind|Makes the requests fail.",
	"set_network_delay|ms|Delays the responses.",
	"expire_access_token||Expires the access token.",
	"set_social_account|account|Sets the fake social account.",
	"simulate_push|message,mode|Simulates a remote push.",
	"set_push_permission|status|Sets the fake push permission.",
	"drop_peer|participant|Drops a realtime peer connection.",
	"drop_matchmaker||Drops the matchmaker connection.",
	"set_test_screen|width,height,fill_mode|Sets a test window.",
	"set_virtual_notch|left,top?,right?,bottom?|Sets or clears a virtual notch.",
	"set_virtual_keyboard|height|Sets or clears a virtual keyboard.",
	"set_input_device|device|Sets the input device.",
	"focus_ui|path|Puts the gamepad focus on a UI element.",
	"restart||Restarts the boot.",
	"quit||Exits the app.",
	"extract_logs|offsets?|Reads the log files from byte offsets.",
	"get_requests||Reads the request records.",
	"get_user_state|kind|Reads the UserState cache.",
	"get_resources||Reads the loaded resources and scopes.",
	"get_sound||Reads the BGM, the playing sounds and the haptics.",
	"list_commands||Lists the commands.",
	"set_stats_visible|visible|Shows or hides the stats.",
]

static var _names: PackedStringArray = PackedStringArray()
static var _arg_names: Dictionary[String, PackedStringArray] = {}
static var _min_args: Dictionary[String, int] = {}
static var _descriptions: Dictionary[String, String] = {}


static func has(command_name: String) -> bool:
	_read_specs()
	return _arg_names.has(command_name)


static func accepts_count(command_name: String, count: int) -> bool:
	_read_specs()
	if command_name == "set_virtual_notch":
		return count == 1 or count == 4
	return count >= _min_args[command_name] and count <= _arg_names[command_name].size()


## The argument ms a command waits on top of `QACore.commandTimeoutMs`. `step` moves game time, which goes at
## `time_scale` (permille, the time scale when the command starts): its ms × 1000 ÷ `time_scale`, rounded up.
static func extra_limit_ms(command_name: String, args: PackedStringArray, time_scale: int = _MS_PER_S) -> int:
	var index: int = -1
	match command_name:
		"drag":
			index = 4
		"key", "capture_video", "step":
			index = 1 if command_name == "key" else 0
	if index < 0 or index >= args.size() or not _ARGS.is_count(args[index]):
		return 0
	var ms: int = _ARGS.to_int(args[index])
	if command_name != "step":
		return ms
	# A step over `QACore.stepMaxMs` fails at once; the bound keeps the product in range.
	if ms > QACore._step_max_ms or time_scale < 1:
		return 0
	return (ms * _MS_PER_S + time_scale - 1) / time_scale


## `list_commands`: built-in and content commands with description and argument names.
static func list_commands_json() -> String:
	_read_specs()
	var items: PackedStringArray = PackedStringArray()
	for command_name: String in _names:
		items.append(_command_json(command_name, _descriptions[command_name], _arg_names[command_name]))
	for command_name: String in QACore._content_names:
		items.append(_command_json(command_name, QACore._content_descriptions[command_name], QACore._content_args[command_name]))
	return _JSON.array(items)


## Command list of the debug screen: one line a command, its name and argument names.
static func command_lines() -> String:
	_read_specs()
	var lines: PackedStringArray = PackedStringArray()
	for command_name: String in _names:
		lines.append(command_name + " " + " ".join(_arg_names[command_name]))
	for command_name: String in QACore._content_names:
		lines.append(command_name + " " + " ".join(QACore._content_args[command_name]))
	return "\n".join(lines)


static func _command_json(command_name: String, description: String, args: PackedStringArray) -> String:
	return _JSON.object(PackedStringArray([
		_JSON.pair("name", _JSON.text(command_name)),
		_JSON.pair("description", _JSON.text(description)),
		_JSON.pair("args", _JSON.strings(args)),
	]))


static func _read_specs() -> void:
	if not _names.is_empty():
		return
	for line: String in _SPECS:
		var spec: PackedStringArray = line.split("|")
		var command_name: String = spec[0]
		var names: PackedStringArray = PackedStringArray()
		var required: int = 0
		for arg: String in spec[1].split(",", false):
			if arg.ends_with("?"):
				names.append(arg.trim_suffix("?"))
			else:
				names.append(arg)
				required += 1
		_names.append(command_name)
		_arg_names[command_name] = names
		_min_args[command_name] = required
		_descriptions[command_name] = spec[2]


# --- run ---


## Async. Runs the built-in command `command` names, whose argument count is checked.
static func run(command: _COMMAND) -> void:
	var a: PackedStringArray = command.args
	match command.name:
		"get_state":
			_ok(command, _QUERY.state_json())
		"get_stats":
			_ok(command, _QUERY.stats_json())
		"get_telemetry":
			_ok(command, QACore._telemetry.to_json())
		"clear_telemetry":
			QACore._telemetry.start()
			_ok(command)
		"capture_screen":
			await _capture_screen(command)
		"capture_video":
			await _capture_video(command)
		"list_ui":
			_ok(command, _QUERY.list_ui_json())
		"get_anchor":
			_get_anchor(command)
		"tap":
			if _check_position(command, a[0], a[1]):
				await _tap(command, _game_position(a[0], a[1]))
		"tap_anchor":
			await _tap_anchor(command)
		"drag":
			await _drag(command)
		"key":
			await _key(command)
		"text":
			await _text(command)
		"touch_down", "touch_move", "touch_up":
			await _touch(command)
		"key_down", "key_up":
			await _key_hold(command)
		"mouse_move", "mouse_down", "mouse_up":
			await _mouse(command)
		"pad_button_down", "pad_button_up":
			await _pad_button(command)
		"pad_axis":
			await _pad_axis(command)
		"go_to_scene":
			await _go_to_scene(command)
		"open_panel":
			await _open_panel(command)
		"set_time_scale":
			if _need(command, _ARGS.is_int_at_least(a[0], 1) and _ARGS.to_int(a[0]) <= QACore._time_scale_max_permille,
					"permille is not an integer of 1 to QACore.timeScaleMaxPermille") \
					and _need_module(command, TimeCore.is_initialized(), "TimeCore"):
				TimeCore.set_time_scale(_ARGS.to_int(a[0]))
				_ok(command)
		"set_step_mode":
			_set_step_mode(command)
		"leave_match":
			_leave_match(command)
		"step":
			await _step(command)
		"set_language":
			_set_language(command)
		"set_server_time_offset":
			await _set_server_time_offset(command)
		"set_user_state", "delete_user_state":
			await _user_state_cheat(command)
		"set_item_balance":
			await _set_item_balance(command)
		"set_mission_progress":
			await _set_mission_progress(command)
		"set_reset_counter":
			await _set_reset_counter(command)
		"set_quality_level":
			_set_quality_level(command)
		"set_text_scale":
			if _need(command, _ARGS.is_int_at_least(a[0], 1000), "permille is not an integer of at least 1000") \
					and _need_module(command, AccessibilityCore.is_initialized(), "AccessibilityCore"):
				AccessibilityCoreDev.set_test_text_scale(_ARGS.to_int(a[0]))
				_ok(command)
		"force_network_failure":
			_force_network_failure(command)
		"set_network_delay":
			if _need(command, _ARGS.is_count(a[0]), "ms is not an integer of at least 0") \
					and _need_module(command, NetworkCore.is_initialized(), "NetworkCore"):
				NetworkCoreDev.force_delay(_ARGS.to_int(a[0]))
				_ok(command)
		"expire_access_token":
			if _need_module(command, AuthCore.is_initialized(), "AuthCore"):
				AuthCoreDev.expire_access_token()
				_ok(command)
		"set_social_account":
			if _need(command, UtilCore.is_snake_case(a[0]), "the account name is not snake_case") \
					and _need_module(command, AuthCore.is_initialized(), "AuthCore"):
				AuthCoreDev.set_fake_social_account(a[0])
				_ok(command)
		"simulate_push":
			_simulate_push(command)
		"set_push_permission":
			_set_push_permission(command)
		"drop_peer":
			_drop_peer(command)
		"drop_matchmaker":
			if _need_module(command, RealtimeCore.is_initialized(), "RealtimeCore"):
				_result(command, RealtimeCoreDev.force_matchmaker_lost(), "force_matchmaker_lost failed")
		"set_test_screen":
			_set_test_screen(command)
		"set_virtual_notch":
			_set_virtual_notch(command)
		"set_virtual_keyboard":
			_set_virtual_keyboard(command)
		"set_input_device":
			await _set_input_device(command)
		"focus_ui":
			_focus_ui(command)
		"restart":
			command.after = QACore._publish_restart
			_ok(command)
		"quit":
			command.after = QACore._request_quit
			_ok(command)
		"extract_logs":
			_extract_logs(command)
		"get_requests":
			_get_requests(command)
		"get_user_state":
			_get_user_state(command)
		"get_resources":
			_get_resources(command)
		"get_sound":
			_get_sound(command)
		"list_commands":
			_ok(command, list_commands_json())
		"set_stats_visible":
			if _need(command, a[0] == _TRUE or a[0] == _FALSE, "visible is not true or false"):
				QACore._set_stats_visible(a[0] == _TRUE)
				_ok(command)
		_:
			_fail(command, "unknown command")


# --- result helpers ---


static func _ok(command: _COMMAND, result: String = "", bytes: PackedByteArray = PackedByteArray()) -> void:
	QACore._finish(command, true, result, bytes)


static func _fail(command: _COMMAND, reason: String) -> void:
	QACore._fail(command, reason)


## Ends with `ok` = `ok`, failing with `reason`.
static func _result(command: _COMMAND, ok: bool, reason: String) -> void:
	if ok:
		_ok(command)
	else:
		_fail(command, reason)


## Fails with `reason` unless `condition`. Returns `condition`.
static func _need(command: _COMMAND, condition: bool, reason: String) -> bool:
	if not condition:
		_fail(command, reason)
	return condition


## Fails unless `initialized`, the init check of `module_name`.
static func _need_module(command: _COMMAND, initialized: bool, module_name: String) -> bool:
	return _need(command, initialized, module_name + " is not in the module list")


## Whether `command` should stop after an await: it ended, or `QACore` was released.
static func _gone(command: _COMMAND) -> bool:
	return command.done or command.session != QACore._session


static func _frame() -> void:
	await (Engine.get_main_loop() as SceneTree).process_frame


## Whether `command` puts in no more device input: the end of its automation channel connection ended it, or `QACore`
## was released.
static func _cut(command: _COMMAND) -> bool:
	return command.cut or command.session != QACore._session


## Async. Ends at the start of the next frame, once the device inputs put before it are in, before the process
## callbacks of that frame. A `frame_started` of a frame start that came before the call does not end it: a deferred
## call queued before `process_frame` runs in the flush before that frame start's `frame_started`.
static func _frame_start() -> void:
	var node: _NODE = QACore._node
	var after: int = QACore._frame_start_count
	while is_instance_valid(node) and node == QACore._node and QACore._started_frame_count <= after:
		await node.frame_started


## Async. Ends after the process callbacks of the frame that goes on.
static func _frame_end() -> void:
	var node: _NODE = QACore._node
	if is_instance_valid(node):
		await node.frame_ended


## Async. Ends `command` after the frame that puts in its device inputs put before it.
static func _end_after_input(command: _COMMAND) -> void:
	await _frame_start()
	if _cut(command):
		return
	await _frame_end()
	_ok(command)


static func _real_now() -> int:
	return TimeCore.get_real_time() if TimeCore.is_initialized() else 0


# --- positions and input ---


static func _check_position(command: _COMMAND, x: String, y: String) -> bool:
	return _need(command, _ARGS.is_real(x) and _ARGS.is_real(y), "a position is not a real number") \
		and _need_module(command, ResolutionCore.is_initialized() and InputCore.is_initialized(), "InputCore")


static func _game_position(x: String, y: String) -> Vector2:
	return ResolutionCore.window_to_game(Vector2(_ARGS.to_real(x), _ARGS.to_real(y)))


## Puts device input `event` of `command` in at the start of the next frame.
static func _put(command: _COMMAND, event: InputEvent) -> void:
	QACore._put_input(command, event)


## Async. Touch press at `position` (game coordinates), release in the next frame.
static func _tap(command: _COMMAND, position: Vector2) -> void:
	var index: int = QACore._input.free_touch_index(QACore._touch_index_count)
	if not _need(command, index >= 0, "every touch index is pressed"):
		return
	_put(command, _INPUT.touch_event(index, position, true))
	await _frame_start()
	if _cut(command):
		return
	_put(command, _INPUT.touch_event(index, position, false))
	await _end_after_input(command)


static func _tap_anchor(command: _COMMAND) -> void:
	if not _need_module(command, UICore.is_initialized() and InputCore.is_initialized(), "UICore"):
		return
	var key: int = _anchor_key(command)
	if key < 0:
		return
	var anchor: AnchorResult = UICore.get_anchor_rect(command.args[0], key)
	if not _need(command, anchor.found and anchor.visible, "the anchor is not there or not visible"):
		return
	if not _need(command, not UICore.is_modal_covered(anchor.element), "a modal popup covers the anchor"):
		return
	await _tap(command, anchor.rect.get_center())


static func _get_anchor(command: _COMMAND) -> void:
	if not _need_module(command, UICore.is_initialized(), "UICore"):
		return
	var key: int = _anchor_key(command)
	if key < 0:
		return
	var anchor: AnchorResult = UICore.get_anchor_rect(command.args[0], key)
	_ok(command, _JSON.object(PackedStringArray([
		_JSON.pair("found", _JSON.boolean(anchor.found)),
		_JSON.pair("visible", _JSON.boolean(anchor.visible)),
		_JSON.pair("rect", _JSON.rect(_QUERY._window_rect(anchor.rect))),
	])))


## The anchor key of the optional second argument: an ID name or an integer of at least 1. 0 when it is left out,
## -1 after a failure.
static func _anchor_key(command: _COMMAND) -> int:
	if command.args.size() < 2:
		return 0
	var text: String = command.args[1]
	if _ARGS.is_id_name(text):
		var value: int = GameDataDev.find_id_value(text)
		if _need(command, value != 0, "the anchor key is not an ID name of the data"):
			return value
		return -1
	if _need(command, _ARGS.is_int_at_least(text, 1), "the anchor key is not an ID name or an integer of at least 1"):
		return _ARGS.to_int(text)
	return -1


static func _drag(command: _COMMAND) -> void:
	var a: PackedStringArray = command.args
	if not _check_position(command, a[0], a[1]) or not _check_position(command, a[2], a[3]):
		return
	if not _need(command, _ARGS.is_count(a[4]), "ms is not an integer of at least 0"):
		return
	var index: int = QACore._input.free_touch_index(QACore._touch_index_count)
	if not _need(command, index >= 0, "every touch index is pressed"):
		return
	var from: Vector2 = _game_position(a[0], a[1])
	var to: Vector2 = _game_position(a[2], a[3])
	var duration: int = _ARGS.to_int(a[4])
	_put(command, _INPUT.touch_event(index, from, true))
	await _frame_start()
	if _cut(command):
		return
	var started: int = _real_now()
	var position: Vector2 = from
	# After each frame from the press frame: the move of the next frame, and at the last one the release with it.
	while true:
		await _frame_end()
		if _cut(command):
			return
		var elapsed: int = _real_now() - started
		var last: bool = elapsed >= duration or command.done
		var next: Vector2 = to if last else from.lerp(to, clampf(float(elapsed) / float(duration), 0.0, 1.0))
		if next != position:
			_put(command, _INPUT.drag_event(index, next, next - position))
			position = next
		if last:
			break
	_put(command, _INPUT.touch_event(index, position, false))
	await _end_after_input(command)


static func _key(command: _COMMAND) -> void:
	if not _need_module(command, InputCore.is_initialized(), "InputCore"):
		return
	var code: Key = _INPUT.key_code(command.args[0])
	if not _need(command, code != KEY_NONE, "not a key name"):
		return
	var ms: int = 0
	if command.args.size() > 1:
		if not _need(command, _ARGS.is_count(command.args[1]), "ms is not an integer of at least 0"):
			return
		ms = _ARGS.to_int(command.args[1])
	_put(command, _INPUT.key_event(code, true))
	await _frame_start()
	if _cut(command):
		return
	var started: int = _real_now()
	while true:
		await _frame_end()
		if _cut(command):
			return
		if command.done or _real_now() - started >= ms:
			break
	_put(command, _INPUT.key_event(code, false))
	await _end_after_input(command)


## Async. One text input a frame. A character is one Unicode code point, the unit of `String`.
static func _text(command: _COMMAND) -> void:
	if not _need_module(command, InputCore.is_initialized(), "InputCore"):
		return
	var text: String = command.args[0]
	if not _need(command, text.length() >= 1 and text.length() <= QACore._text_max_chars,
			"the text length is out of range"):
		return
	for i: int in text.length():
		_put(command, _INPUT.text_event(text[i]))
		await _frame_start()
		if _gone(command):
			return
	await _frame_end()
	_ok(command)


static func _touch(command: _COMMAND) -> void:
	var a: PackedStringArray = command.args
	if not _need_module(command, InputCore.is_initialized() and ResolutionCore.is_initialized(), "InputCore"):
		return
	if not _need(command, _ARGS.is_count(a[0]) and _ARGS.to_int(a[0]) < QACore._touch_index_count,
			"the touch index is out of range"):
		return
	var index: int = _ARGS.to_int(a[0])
	var held: bool = QACore._input.touches.has(index)
	if command.name == "touch_up":
		if not _need(command, held, "the touch index is not pressed"):
			return
		_put(command, _INPUT.touch_event(index, QACore._input.touches[index], false))
	else:
		if not _check_position(command, a[1], a[2]):
			return
		var position: Vector2 = _game_position(a[1], a[2])
		if command.name == "touch_down":
			if not _need(command, not held, "the touch index is pressed"):
				return
			_put(command, _INPUT.touch_event(index, position, true))
		else:
			if not _need(command, held, "the touch index is not pressed"):
				return
			_put(command, _INPUT.drag_event(index, position, position - QACore._input.touches[index]))
	await _end_after_input(command)


static func _key_hold(command: _COMMAND) -> void:
	if not _need_module(command, InputCore.is_initialized(), "InputCore"):
		return
	var code: Key = _INPUT.key_code(command.args[0])
	if not _need(command, code != KEY_NONE, "not a key name"):
		return
	var held: bool = QACore._input.keys.has(code)
	var down: bool = command.name == "key_down"
	if not _need(command, held != down, "the key is pressed" if down else "the key is not pressed"):
		return
	_put(command, _INPUT.key_event(code, down))
	await _end_after_input(command)


static func _mouse(command: _COMMAND) -> void:
	var a: PackedStringArray = command.args
	var moving: bool = command.name == "mouse_move"
	if not _check_position(command, a[0 if moving else 1], a[1 if moving else 2]):
		return
	var position: Vector2 = _game_position(a[0 if moving else 1], a[1 if moving else 2])
	if moving:
		_put(command, QACore._input.mouse_motion_event(position))
		await _end_after_input(command)
		return
	var button: int = _INPUT.mouse_button(a[0])
	if not _need(command, button >= 0, "the mouse button is not left, right or middle"):
		return
	var down: bool = command.name == "mouse_down"
	var held: bool = QACore._input.mouse_buttons.has(button)
	if not _need(command, held != down, "the button is pressed" if down else "the button is not pressed"):
		return
	_put(command, QACore._input.mouse_motion_event(position))
	_put(command, QACore._input.mouse_button_event(button, position, down))
	await _end_after_input(command)


static func _pad_button(command: _COMMAND) -> void:
	if not _need_module(command, InputCore.is_initialized(), "InputCore"):
		return
	var button: int = _INPUT.pad_button(command.args[0])
	if not _need(command, button >= 0, "not a gamepad button name"):
		return
	var down: bool = command.name == "pad_button_down"
	var held: bool = QACore._input.pad_buttons.has(button)
	if not _need(command, held != down, "the button is pressed" if down else "the button is not pressed"):
		return
	_put(command, _INPUT.pad_button_event(button, down))
	await _end_after_input(command)


static func _pad_axis(command: _COMMAND) -> void:
	if not _need_module(command, InputCore.is_initialized(), "InputCore"):
		return
	var axis: int = _INPUT.pad_axis(command.args[0])
	if not _need(command, axis >= 0, "not a gamepad axis name"):
		return
	if not _need(command, _ARGS.is_real(command.args[1]), "the value is not a real number"):
		return
	var value: float = _ARGS.to_real(command.args[1])
	if not _need(command, _INPUT.is_in_axis_range(command.args[0], value), "the value is out of the axis range"):
		return
	_put(command, _INPUT.pad_axis_event(axis, value))
	await _end_after_input(command)


static func _set_input_device(command: _COMMAND) -> void:
	var device: int = _INPUT_DEVICES.find(command.args[0])
	if not _need(command, device >= 0, "not an input device"):
		return
	if not _need_module(command, InputCore.is_initialized(), "InputCore"):
		return
	InputCoreDev.set_test_device(device as InputCore.InputDevice)
	await _frame()
	await _frame()
	_ok(command)


static func _focus_ui(command: _COMMAND) -> void:
	if not _need_module(command, UICore.is_initialized(), "UICore"):
		return
	var element: Control = _QUERY.element_at(command.args[0])
	if not _need(command, element != null, "no visible UI element has the path"):
		return
	_result(command, UICoreDev.set_test_focus(element), "set_test_focus failed")


# --- capture ---


static func _capture_screen(command: _COMMAND) -> void:
	if not _need(command, not QACore.is_headless(), "a headless run has no screen"):
		return
	var png: PackedByteArray = await QACore._capture_png()
	if _gone(command):
		return
	if _need(command, not png.is_empty(), "could not read the screen"):
		_ok(command, "", png)


static func _capture_video(command: _COMMAND) -> void:
	if not _need(command, _ARGS.is_int_at_least(command.args[0], 1) and _ARGS.to_int(command.args[0]) <= QACore._video_max_ms,
			"ms is out of range"):
		return
	if not _need(command, not QACore.is_headless(), "a headless run has no screen"):
		return
	if not _need(command, QACore._has_channel(), "there is no automation channel connection"):
		return
	var duration: int = _ARGS.to_int(command.args[0])
	var fps: int = QACore._video_fps
	var frames: int = int(float(duration * fps) / float(_MS_PER_S))
	var started: int = _real_now()
	for frame: int in frames:
		var at: int = started + int(float(frame * _MS_PER_S) / float(fps))
		while not _gone(command) and _real_now() < at:
			await _frame()
		if _gone(command):
			return
		var png: PackedByteArray = await QACore._capture_png()
		if _gone(command):
			return
		if not _need(command, not png.is_empty(), "could not read the screen"):
			return
		if not _need(command, QACore._send_frame(command, frame, png), "could not send a frame"):
			return
	_ok(command, _JSON.object(PackedStringArray([
		_JSON.pair("frame_count", _JSON.integer(frames)),
		_JSON.pair("fps", _JSON.integer(fps)),
	])))


# --- setup ---


static func _go_to_scene(command: _COMMAND) -> void:
	if not _need_module(command, SceneCore.is_initialized(), "SceneCore"):
		return
	var ok: bool = await SceneCore.change_scene(command.args[0], null)
	_result(command, ok, "change_scene failed")


static func _open_panel(command: _COMMAND) -> void:
	if not _need_module(command, UICore.is_initialized(), "UICore"):
		return
	var ok: bool = await UICore.open_panel(command.args[0], null, false)
	_result(command, ok, "open_panel failed")


static func _set_step_mode(command: _COMMAND) -> void:
	var mode: String = command.args[0]
	if not _need(command, mode == _ON or mode == _OFF, "the mode is not on or off"):
		return
	if not _need_module(command, TimeCore.is_initialized(), "TimeCore"):
		return
	var in_match: bool = RealtimeCore.is_initialized() and RealtimeCore.match_state() != RealtimeCore.MatchState.NONE
	if not _need(command, not in_match, "a realtime match is going on"):
		return
	QACore._set_step_mode(mode == _ON)
	_ok(command)


static func _leave_match(command: _COMMAND) -> void:
	if not _need_module(command, RealtimeCore.is_initialized(), "RealtimeCore"):
		return
	if RealtimeCore.match_state() != RealtimeCore.MatchState.NONE:
		RealtimeCore.leave()
	_result(command, RealtimeCore.match_state() == RealtimeCore.MatchState.NONE, "the match state is not None")


static func _step(command: _COMMAND) -> void:
	var text: String = command.args[0]
	if not _need(command, _ARGS.is_int_at_least(text, 1) and _ARGS.to_int(text) <= QACore._step_max_ms, "ms is out of range"):
		return
	if not _need(command, TimeCore.is_initialized() and TimeCoreDev.is_step_mode(), "step mode is off"):
		return
	if not _need(command, not TimeCore.is_paused(), "game time is paused"):
		return
	var ms: int = _ARGS.to_int(text)
	if RealtimeCore.is_initialized() and RealtimeCore.match_state() == RealtimeCore.MatchState.PLAYING \
			and RealtimeCore.match_info().lockstep:
		await _lockstep_step(command, ms)
		return
	command.on_fail = _clear_step_budget
	TimeCoreDev.add_step_budget(ms)
	while not _gone(command) and TimeCore.is_initialized() and TimeCoreDev.get_step_budget() > 0:
		await _frame()
	if command.session != QACore._session:
		return
	_ok(command)


## Async. The lockstep branch of `step`. A `step` over its time limit leaves the budget and step mode as they are and
## lets its `request_step` run to its end; its result is dropped, and a lockstep `step` before that end fails.
static func _lockstep_step(command: _COMMAND, ms: int) -> void:
	if not _need(command, not QACore._lockstep_step_running, "the request_step of an earlier step has not returned"):
		return
	var session: RefCounted = QACore._session
	QACore._lockstep_step_running = true
	var stepped: bool = await RealtimeCoreDev.request_step(ms)
	if session != QACore._session:
		return
	QACore._lockstep_step_running = false
	_result(command, stepped, "request_step failed")


## A `step` that added budget failed (over its time limit): turning step mode on again makes the budget left 0, so it
## does not run after the command.
static func _clear_step_budget() -> void:
	if TimeCore.is_initialized() and TimeCoreDev.is_step_mode():
		QACore._set_step_mode(true)


static func _set_language(command: _COMMAND) -> void:
	if not _need_module(command, LocalizationCore.is_initialized() and DataCore.is_initialized() and DataCore.is_loaded(),
			"LocalizationCore"):
		return
	var language: int = 0
	for row: GameData.LanguageRow in GameData.LanguageTable.all_rows():
		if row.code == command.args[0]:
			language = row.id
	if not _need(command, language != 0, "not a language code of the data"):
		return
	if not _need(command, LocalizationCore.select_language(language), "select_language failed"):
		return
	command.after = QACore._publish_restart
	_ok(command)


static func _set_quality_level(command: _COMMAND) -> void:
	var level: int = _QUERY.QUALITY_LEVEL_NAMES.find(command.args[0])
	if not _need(command, level >= 0, "the level is not Low, Medium or High"):
		return
	if not _need_module(command, QualityCore.is_initialized(), "QualityCore"):
		return
	QualityCoreDev.set_test_level(level as QualityCore.QualityLevel)
	_ok(command)


static func _force_network_failure(command: _COMMAND) -> void:
	var kind: int = -2
	match command.args[0]:
		"timeout":
			kind = NetworkCore.FailureKind.TIMEOUT
		"connection_failed":
			kind = NetworkCore.FailureKind.CONNECTION_FAILED
		_NONE:
			kind = -1
	if not _need(command, kind != -2, "the kind is not timeout, connection_failed or none"):
		return
	if not _need_module(command, NetworkCore.is_initialized(), "NetworkCore"):
		return
	NetworkCoreDev.force_failure(kind)
	_ok(command)


static func _simulate_push(command: _COMMAND) -> void:
	var mode: String = command.args[1]
	if not _need(command, mode == "received" or mode == "opened", "the mode is not received or opened"):
		return
	if not _need(command, _ARGS.is_id_name(command.args[0]), "the message is not an ID name"):
		return
	var message: int = GameDataDev.find_id_value(command.args[0])
	if not _need(command, message != 0, "the message is not an ID name of the data"):
		return
	if not _need_module(command, PushCore.is_initialized(), "PushCore"):
		return
	PushCoreDev.simulate_push(message, mode == "opened")
	_ok(command)


static func _set_push_permission(command: _COMMAND) -> void:
	var status: int = _PUSH_PERMISSIONS.find(command.args[0])
	if not _need(command, status >= 0, "the status is not a push permission status"):
		return
	if not _need_module(command, PushCore.is_initialized(), "PushCore"):
		return
	PushCoreDev.set_fake_permission(status as PushCore.PermissionStatus)
	_ok(command)


static func _drop_peer(command: _COMMAND) -> void:
	var text: String = command.args[0]
	if not _need(command, text == _OTHER or _ARGS.is_count(text), "the participant is not an index of at least 0 or other"):
		return
	if not _need_module(command, RealtimeCore.is_initialized(), "RealtimeCore"):
		return
	var participant: int = -1
	if text == _OTHER:
		var info: MatchInfo = RealtimeCore.match_info()
		for index: int in info.user_ids.size():
			if index != info.my_index and RealtimeCore.peer_state(index) == RealtimeCore.PeerState.CONNECTED:
				participant = index
				break
		if not _need(command, participant >= 0, "no other participant is Connected"):
			return
	else:
		participant = _ARGS.to_int(text)
	_result(command, RealtimeCoreDev.force_peer_lost(participant), "force_peer_lost failed")


static func _set_test_screen(command: _COMMAND) -> void:
	var a: PackedStringArray = command.args
	if not _need(command, _ARGS.is_int_at_least(a[0], 1) and _ARGS.is_int_at_least(a[1], 1),
			"the window size is not 2 integers of at least 1"):
		return
	var fill_mode: int = _FILL_MODES.find(a[2])
	if not _need(command, fill_mode >= 0, "the fill mode is not Crop or Letterbox"):
		return
	if not _need_module(command, ResolutionCore.is_initialized(), "ResolutionCore"):
		return
	ResolutionCoreDev.set_test_screen(QACore._base_resolution, Vector2i(_ARGS.to_int(a[0]), _ARGS.to_int(a[1])),
		fill_mode as ResolutionCore.FillMode, false)
	_ok(command)


static func _set_virtual_notch(command: _COMMAND) -> void:
	var a: PackedStringArray = command.args
	if a.size() == 1:
		if not _need(command, a[0] == _NONE, "the argument is not none"):
			return
	else:
		for text: String in a:
			if not _need(command, _ARGS.is_count(text), "a distance is not an integer of at least 0"):
				return
	if not _need_module(command, SafeAreaCore.is_initialized(), "SafeAreaCore"):
		return
	if a.size() == 1:
		SafeAreaCoreDev.clear_virtual_notch()
	else:
		SafeAreaCoreDev.set_virtual_notch(_ARGS.to_int(a[0]), _ARGS.to_int(a[1]), _ARGS.to_int(a[2]), _ARGS.to_int(a[3]))
	_ok(command)


static func _set_virtual_keyboard(command: _COMMAND) -> void:
	var text: String = command.args[0]
	if not _need(command, text == _NONE or _ARGS.is_int_at_least(text, 1), "the height is not an integer of at least 1 or none"):
		return
	if not _need_module(command, SafeAreaCore.is_initialized(), "SafeAreaCore"):
		return
	if text == _NONE:
		SafeAreaCoreDev.clear_virtual_keyboard()
	else:
		SafeAreaCoreDev.set_virtual_keyboard(_ARGS.to_int(text))
	_ok(command)


# --- cheats ---


static func _send_cheat(command: _COMMAND, request: ContractRequest) -> void:
	if not _need_module(command, NetworkCore.is_initialized(), "NetworkCore"):
		return
	var ok: bool = await NetworkCoreDev.send_cheat(request)
	if _gone(command):
		return
	_result(command, ok, "the cheat request failed")


static func _set_server_time_offset(command: _COMMAND) -> void:
	if not _need(command, _ARGS.is_int(command.args[0]), "ms is not an integer"):
		return
	var request: CoreCheatContract.SetTimeOffsetRequest = CoreCheatContract.SetTimeOffsetRequest.new()
	request.offset_ms = _ARGS.to_int(command.args[0])
	await _send_cheat(command, request)


## The ID value of ID name `text`; 0 after a failure with `what` in the reason.
static func _id_value(command: _COMMAND, text: String, what: String) -> int:
	if not _need(command, _ARGS.is_id_name(text), what + " is not an ID name"):
		return 0
	var value: int = GameDataDev.find_id_value(text)
	_need(command, value != 0, what + " is not an ID name of the data")
	return value


static func _user_state_cheat(command: _COMMAND) -> void:
	var a: PackedStringArray = command.args
	var kind: ContractKind = find_kind(a[0])
	if not _need(command, kind != null, "not a UserState kind"):
		return
	var item_id: int = 0
	if kind.is_list:
		if _ARGS.is_id_name(a[1]):
			item_id = _id_value(command, a[1], _ITEM_KIND)
			if item_id == 0:
				return
		elif not _need(command, _ARGS.is_count(a[1]), "the item is not an ID name or an integer of at least 0"):
			return
		else:
			item_id = _ARGS.to_int(a[1])
	elif not _need(command, a[1] == _SINGLE_ITEM, "the item of a single kind is not []"):
		return
	if command.name == "delete_user_state":
		var delete_request: CoreCheatContract.DeleteUserStateRequest = CoreCheatContract.DeleteUserStateRequest.new()
		delete_request.kind = kind.name
		delete_request.item_id = item_id
		await _send_cheat(command, delete_request)
		return
	var json: String = _value_json(command, kind, item_id, a[2])
	if json.is_empty():
		return
	var request: CoreCheatContract.SetUserStateRequest = CoreCheatContract.SetUserStateRequest.new()
	request.kind = kind.name
	request.item_id = item_id
	request.value_json = json
	await _send_cheat(command, request)


## The proto3 JSON of the kind message of `text`: each string that is an ID name as its ID value, and `id` = `item_id`
## for a list kind. Empty after a failure.
static func _value_json(command: _COMMAND, kind: ContractKind, item_id: int, text: String) -> String:
	var replaced: PackedStringArray = PackedStringArray()
	var unknown: String = replace_id_names(text, replaced)
	if not _need(command, unknown.is_empty(), "the value has a string that is not an ID name of the data"):
		return ""
	if not _need(command, replaced.size() == 1 and is_json_object(replaced[0]), "the value is not a JSON object"):
		return ""
	var json: String = replaced[0]
	if kind.is_list:
		var body: String = json.strip_edges()
		body = body.substr(0, body.length() - 1).strip_edges()
		var member: String = _JSON.pair("id", _JSON.text(str(item_id)))
		json = (body + "," if body != "{" else body) + member + "}"
	var message: ContractMessage = kind.kind_class.new()
	if not _need(command, ContractJsonDev.from_json(message, json), "the value is not that kind"):
		return ""
	return ContractJsonDev.to_json(message)


static func _set_item_balance(command: _COMMAND) -> void:
	var item_id: int = _id_value(command, command.args[0], _ITEM_KIND)
	if item_id == 0:
		return
	var balance: String = command.args[1]
	if not _need(command, _ARGS.is_big_count(balance), "the balance is not a big integer of at least 0"):
		return
	var request: CoreCheatContract.SetItemBalanceRequest = CoreCheatContract.SetItemBalanceRequest.new()
	request.item_id = item_id
	if _ARGS.is_safe_integer(balance):
		request.balance = balance.to_int()
	else:
		request.big_balance = balance
	await _send_cheat(command, request)


static func _set_mission_progress(command: _COMMAND) -> void:
	var a: PackedStringArray = command.args
	var mission_id: int = _id_value(command, a[0], "the mission")
	if mission_id == 0:
		return
	if not _need(command, _ARGS.is_count(a[1]), "the progress is not an integer of at least 0"):
		return
	if not _need(command, a[2] == _TRUE or a[2] == _FALSE, "claimed is not true or false"):
		return
	var request: CoreCheatContract.SetMissionProgressRequest = CoreCheatContract.SetMissionProgressRequest.new()
	request.mission_id = mission_id
	request.progress = _ARGS.to_int(a[1])
	request.claimed = a[2] == _TRUE
	await _send_cheat(command, request)


static func _set_reset_counter(command: _COMMAND) -> void:
	var counter_id: int = _id_value(command, command.args[0], "the reset counter")
	if counter_id == 0:
		return
	if not _need(command, _ARGS.is_count(command.args[1]), "the count is not an integer of at least 0"):
		return
	var request: CoreCheatContract.SetResetCounterRequest = CoreCheatContract.SetResetCounterRequest.new()
	request.counter_id = counter_id
	request.count = _ARGS.to_int(command.args[1])
	await _send_cheat(command, request)


## The UserState kind named `kind_name`, of the base proto or the game contract; `null` when there is none.
static func find_kind(kind_name: String) -> ContractKind:
	for kind: ContractKind in CoreContract.user_state_kinds():
		if kind.name == kind_name:
			return kind
	for kind: ContractKind in GameContract.user_state_kinds():
		if kind.name == kind_name:
			return kind
	return null


## Puts `text` with every JSON string whose whole value is an ID name replaced by its ID value into `out`. Returns
## the first ID name that is not in the data; empty when every one is. A text that is not JSON is put in as it is.
# ogw:input_boundary
static func replace_id_names(text: String, out: PackedStringArray) -> String:
	var parts: PackedStringArray = PackedStringArray()
	var i: int = 0
	var start: int = 0
	while i < text.length():
		if text[i] != "\"":
			i += 1
			continue
		var end: int = i + 1
		while end < text.length() and text[end] != "\"":
			end += 2 if text[end] == "\\" else 1
		if end >= text.length():
			break
		var token: String = text.substr(i, end - i + 1)
		var value: Variant = JSON.parse_string(token)
		var id_name: String = value if value is String else ""
		if _ARGS.is_id_name(id_name) and not _is_key(text, end + 1):
			var id_value: int = GameDataDev.find_id_value(id_name)
			if id_value == 0:
				return id_name
			parts.append(text.substr(start, i - start))
			parts.append(str(id_value))
			start = end + 1
		i = end + 1
	parts.append(text.substr(start))
	out.append("".join(parts))
	return ""


## Whether the next character from `from` that is not white space is `:`: the string before it is an object key.
static func _is_key(text: String, from: int) -> bool:
	for i: int in range(from, text.length()):
		var character: String = text[i]
		if character != " " and character != "\t" and character != "\n" and character != "\r":
			return character == ":"
	return false


# ogw:input_boundary
static func is_json_object(text: String) -> bool:
	var parser: JSON = JSON.new()
	return parser.parse(text) == OK and parser.data is Dictionary


# --- reads ---


## `extract_logs`: every log file from its byte offset in the argument (0 for a path without one, or for an offset past
## the end of a file that got shorter) to its end. An offset on a UTF-8 continuation byte moves on to the next byte
## that is not one, or to the end of the file.
static func _extract_logs(command: _COMMAND) -> void:
	if not _need_module(command, LogCore.is_initialized(), "LogCore"):
		return
	var offsets: Dictionary[String, int] = {}
	if not command.args.is_empty() and not _need(command, read_log_offsets(command.args[0], offsets),
			"the offsets are not a JSON object of byte offsets"):
		return
	var items: PackedStringArray = PackedStringArray()
	for path: String in LogCoreDev.list_log_files():
		var offset: int = offsets.get(path, 0)
		var size: int = 0
		var bytes: PackedByteArray = PackedByteArray()
		var file: FileAccess = FileAccess.open(CoreBuildInfo.storage_root + path, FileAccess.READ)
		if file != null:
			size = file.get_length()
			if offset > size:
				offset = 0
			file.seek(offset)
			bytes = file.get_buffer(size - offset)
			file.close()
		else:
			offset = 0
		var skipped: int = 0
		while skipped < bytes.size() and _is_continuation(bytes[skipped]):
			skipped += 1
		items.append(_JSON.object(PackedStringArray([
			_JSON.pair("path", _JSON.text(path)),
			_JSON.pair("offset", _JSON.integer(offset + skipped)),
			_JSON.pair("content", utf8_json(bytes.slice(skipped))),
			_JSON.pair("size", _JSON.integer(size)),
		])))
	_ok(command, _JSON.array(items))


## UTF-8 continuation byte: `10xxxxxx`.
static func _is_continuation(byte: int) -> bool:
	return (byte & 0xC0) == 0x80


## The JSON string of `bytes` read as UTF-8, with one U+FFFD for each byte outside a well-formed UTF-8 sequence. A
## byte 0x00 is U+0000, which a `String` cannot hold, so the JSON text has `\u0000` there. No well-formed sequence has
## a byte 0x00 inside it, so the runs between them read as they would in one piece.
static func utf8_json(bytes: PackedByteArray) -> String:
	var runs: PackedStringArray = PackedStringArray()
	var run_start: int = 0
	while true:
		var zero: int = bytes.find(0, run_start)
		var run: String = _JSON.text(utf8_text(bytes.slice(run_start, zero if zero >= 0 else bytes.size())))
		runs.append(run.substr(1, run.length() - 2))
		if zero < 0:
			break
		run_start = zero + 1
	return "\"" + "\\u0000".join(runs) + "\""


## `bytes` read as UTF-8, with one U+FFFD for each byte outside a well-formed UTF-8 sequence and for a byte 0x00. Only
## the well-formed runs go to the engine decoder, which logs an engine error for a byte it cannot read.
static func utf8_text(bytes: PackedByteArray) -> String:
	var parts: PackedStringArray = PackedStringArray()
	var run_start: int = 0
	var i: int = 0
	while i < bytes.size():
		var length: int = _utf8_sequence_length(bytes, i)
		if length > 0:
			i += length
			continue
		if i > run_start:
			parts.append(bytes.slice(run_start, i).get_string_from_utf8())
		parts.append(char(_REPLACEMENT_CHARACTER))
		i += 1
		run_start = i
	if run_start < bytes.size():
		parts.append(bytes.slice(run_start).get_string_from_utf8())
	return "".join(parts)


## Byte length of the well-formed UTF-8 sequence at `at`; 0 when there is none there: a lone continuation byte, a cut
## or overlong sequence, a surrogate, a code point over U+10FFFF, or U+0000, where the engine decoder ends a string.
static func _utf8_sequence_length(bytes: PackedByteArray, at: int) -> int:
	var lead: int = bytes[at]
	if lead == 0:
		return 0
	if lead < 0x80:
		return 1
	var length: int = 0
	var low: int = 0x80
	var high: int = 0xBF
	if lead >= 0xC2 and lead <= 0xDF:
		length = 2
	elif lead >= 0xE0 and lead <= 0xEF:
		length = 3
		if lead == 0xE0:
			low = 0xA0
		elif lead == 0xED:
			high = 0x9F
	elif lead >= 0xF0 and lead <= 0xF4:
		length = 4
		if lead == 0xF0:
			low = 0x90
		elif lead == 0xF4:
			high = 0x8F
	else:
		return 0
	if at + length > bytes.size():
		return 0
	var second: int = bytes[at + 1]
	if second < low or second > high:
		return 0
	for k: int in range(2, length):
		if not _is_continuation(bytes[at + k]):
			return 0
	return length


## Reads `text`, a JSON object of a byte offset (an integer of 0 or more) per log file path, into `offsets`.
# ogw:input_boundary
static func read_log_offsets(text: String, offsets: Dictionary[String, int]) -> bool:
	var parser: JSON = JSON.new()
	if parser.parse(text) != OK or not parser.data is Dictionary:
		return false
	var data: Dictionary = parser.data
	for path: Variant in data:
		var value: Variant = data[path]
		if not (value is float or value is int):
			return false
		var number: float = value
		if not is_finite(number) or number < 0.0 or number != floorf(number) or number > _MAX_EXACT_INT:
			return false
		offsets[str(path)] = int(number)
	return true


static func _get_requests(command: _COMMAND) -> void:
	if not _need_module(command, NetworkCore.is_initialized(), "NetworkCore"):
		return
	var records: Array[NetworkRequestRecord] = []
	records.resize(_RECORD_ROOM)
	var count: int = NetworkCoreDev.get_request_records(records)
	var items: PackedStringArray = PackedStringArray()
	for i: int in count:
		var record: NetworkRequestRecord = records[i]
		items.append(_JSON.object(PackedStringArray([
			_JSON.pair("name", _JSON.text(record.request_name)),
			_JSON.pair("kind", _JSON.text(_QUERY._name_of(_QUERY.REQUEST_KIND_NAMES, record.kind))),
			_JSON.pair("ok", _JSON.boolean(record.ok)),
			_JSON.pair("error_code", _JSON.integer(record.error_code)),
			_JSON.pair("request", _JSON.text(Marshalls.raw_to_base64(record.request_body) if not record.request_body.is_empty() else "")),
			_JSON.pair("response", _JSON.text(Marshalls.raw_to_base64(record.response_body) if not record.response_body.is_empty() else "")),
		])))
	_ok(command, _JSON.array(items))


static func _get_user_state(command: _COMMAND) -> void:
	if not _need_module(command, UserStateCore.is_initialized(), "UserStateCore"):
		return
	var kind_class: GDScript = null
	if command.args[0] != "all":
		var kind: ContractKind = find_kind(command.args[0])
		if not _need(command, kind != null, "not a UserState kind"):
			return
		kind_class = kind.kind_class
	var json: String = UserStateCoreDev.export_json(kind_class)
	if _need(command, not json.is_empty(), "export_json failed"):
		_ok(command, json)


static func _get_resources(command: _COMMAND) -> void:
	if not _need_module(command, ResourceCore.is_initialized(), "ResourceCore"):
		return
	var resources: PackedStringArray = PackedStringArray()
	var loaded: Dictionary[String, int] = ResourceCoreDev.list_loaded_resources()
	for key: String in loaded:
		resources.append(_JSON.object(PackedStringArray([
			_JSON.pair("key", _JSON.text(key)),
			_JSON.pair("refs", _JSON.integer(loaded[key])),
		])))
	var scopes: PackedStringArray = PackedStringArray()
	for scope: Scope in ResourceCoreDev.list_scopes():
		scopes.append(_JSON.object(PackedStringArray([
			_JSON.pair("kind", _JSON.text(_QUERY._name_of(_QUERY.SCOPE_KIND_NAMES, scope.kind))),
			_JSON.pair("name", _JSON.text(scope.name)),
		])))
	_ok(command, _JSON.object(PackedStringArray([
		_JSON.pair("resources", _JSON.array(resources)),
		_JSON.pair("scopes", _JSON.array(scopes)),
	])))


static func _get_sound(command: _COMMAND) -> void:
	if not _need_module(command, SoundCore.is_initialized(), "SoundCore"):
		return
	var playing: Array[SoundPlayingRecord] = []
	playing.resize(_SOUND_ROOM)
	var playing_count: int = SoundCoreDev.get_playing(playing)
	var playing_items: PackedStringArray = PackedStringArray()
	for i: int in playing_count:
		var record: SoundPlayingRecord = playing[i]
		playing_items.append(_JSON.object(PackedStringArray([
			_JSON.pair("key", _JSON.text(record.key)),
			_JSON.pair("bus", _JSON.text(_QUERY._name_of(_QUERY.SOUND_BUS_NAMES, record.bus))),
			_JSON.pair("priority", _JSON.integer(record.priority)),
		])))
	var haptics: Array[HapticLogRecord] = []
	haptics.resize(_SOUND_ROOM)
	var haptic_count: int = SoundCoreDev.get_haptic_log(haptics)
	var haptic_items: PackedStringArray = PackedStringArray()
	for i: int in haptic_count:
		var record: HapticLogRecord = haptics[i]
		haptic_items.append(_JSON.object(PackedStringArray([
			_JSON.pair("key", _JSON.text(record.key)),
			_JSON.pair("played", _JSON.boolean(record.played)),
			_JSON.pair("target", _JSON.text(_QUERY._name_of(_QUERY.HAPTIC_TARGET_NAMES, record.target))),
		])))
	_ok(command, _JSON.object(PackedStringArray([
		_JSON.pair("bgm", _JSON.text(SoundCore.get_bgm_key())),
		_JSON.pair("playing", _JSON.array(playing_items)),
		_JSON.pair("haptics", _JSON.array(haptic_items)),
	])))
