class_name InputCore
extends RefCounted
## Turns device input into actions and gestures, and owns the input processing order, the input device, key and
## gamepad button bindings and input prompts. Device input goes through the core node: `_input` runs the debug, fill
## area, block, device detection and key wait stages and calls the UI pointer observer, engine GUI is the UI stage,
## and `_unhandled_input` gets the world input. A release of a pressed input source releases it before the UI stage,
## so a release the UI consumes still releases its source.

## Device of the device input that device detection used last.
enum InputDevice { TOUCH, KEYBOARD_MOUSE, GAMEPAD }
## Phase of a drag or a pinch.
enum GesturePhase { START, MOVE, END, CANCEL }
## Binding context of an action, decided by its name.
enum BindingContext { GAMEPLAY, UI, CUTSCENE }

const _NODE_SCRIPT := preload("res://core/input_core/input_core_node.gd")
const _WAIT_SCRIPT := preload("res://core/input_core/input_wait.gd")

const _TAG: String = "InputCore"
const _BACK: StringName = &"back"
const _CORE_ACTIONS: Array[StringName] = [&"back", &"cutscene_advance", &"cutscene_skip"]
const _SETTING_MOVE_THRESHOLD: String = "InputCore.moveThreshold"
const _SETTING_LONG_PRESS_MS: String = "InputCore.longPressMs"
const _SETTING_SWIPE_MAX_MS: String = "InputCore.swipeMaxMs"
const _SETTING_SWIPE_MIN_DISTANCE: String = "InputCore.swipeMinDistance"
const _SETTING_MAX_JUDGE_POINTERS: String = "InputCore.maxJudgePointers"
const _SETTING_MAX_KEYS_PER_ACTION: String = "InputCore.maxKeysPerAction"
const _SETTING_MAX_PAD_BUTTONS_PER_ACTION: String = "InputCore.maxPadButtonsPerAction"
const _SETTING_PAD_AXIS_WAIT_THRESHOLD: String = "InputCore.padAxisWaitThreshold"
const _SETTING_PAD_AXIS_DEADZONE: String = "InputCore.padAxisDeadzone"
## `LocalDataCore` keys of the bindings that differ from the default binding.
const _KEY_BINDINGS: String = "InputCore.key_bindings"
const _PAD_BINDINGS: String = "InputCore.pad_bindings"
## Mouse button names; index + 1 is the `MouseButton` value.
const _MOUSE_BUTTON_NAMES: Array[String] = ["mouse_left", "mouse_right", "mouse_middle"]
## Gamepad button names; the index is the `JoyButton` value.
const _PAD_BUTTON_NAMES: Array[String] = [
	"a", "b", "x", "y", "back", "guide", "start", "left_stick", "right_stick", "left_shoulder", "right_shoulder",
	"dpad_up", "dpad_down", "dpad_left", "dpad_right",
]
## Gamepad axis names; the index is the `JoyAxis` value.
const _PAD_AXIS_NAMES: Array[String] = ["left_x", "left_y", "right_x", "right_y", "trigger_left", "trigger_right"]
## Parts of a lower case `Input.get_joy_name` that decide the gamepad family.
const _XBOX_NAMES: Array[String] = ["xbox", "xinput"]
const _PLAY_STATION_NAMES: Array[String] = ["playstation", "ps3", "ps4", "ps5", "dualshock", "dualsense"]
const _NINTENDO_NAMES: Array[String] = ["nintendo", "switch", "joy-con"]
## Key binding entries are key codes, and `-<MouseButton value>` for mouse buttons. Pad binding entries are
## `JoyButton` values, and `_AXIS_BASE + axis * 2 + 1` (positive) or `_AXIS_BASE + axis * 2` (negative) for gamepad
## axis directions.
const _AXIS_BASE: int = 1000
## Pressed or released frame of a device input not stamped yet. It becomes the process frame number at the next
## `SceneTree.physics_frame`, `SceneTree.process_frame` or core node process callback, whichever comes first, so the
## first process callbacks after the input see it.
const _FRAME_PENDING: int = -2
## The core node processes after `TimeCore` and before the other nodes, so a pending frame is stamped before the
## process callbacks that read the action state.
const _PROCESS_PRIORITY: int = -100000
## Entry of a string that is not a key, mouse button, gamepad button or gamepad axis direction name.
const _NOT_A_NAME: int = -1000000
## Entry of the empty string: key none or button none.
const _NONE_ENTRY: int = -2000000
## Pointer ID of the mouse left button. A touch pointer's ID is its touch index.
const _MOUSE_POINTER_ID: int = 1000000
## Pointer slots beyond `InputCore.maxJudgePointers`, for pressed pointers that are not judge pointers.
const _EXTRA_POINTER_SLOTS: int = 16
## Gamepad slots: gamepads whose button and axis direction sources and last axis inputs are kept at once. A gamepad
## takes a slot at its first press or nonzero axis input and gives it back when it disconnects. A slot whose gamepad
## has no pressed source and no nonzero axis value can be taken by another gamepad.
const _GAMEPAD_SLOTS: int = 16
## Input kinds of a device input.
const _OTHER: int = 0
const _POINTER_PRESS: int = 1
const _POINTER_MOVE: int = 2
const _POINTER_RELEASE: int = 3
const _MOUSE_BUTTON: int = 4
const _MOUSE_MOVE: int = 5
const _KEY: int = 6
const _PAD_BUTTON: int = 7
const _PAD_AXIS: int = 8
## Results of a binding check.
const _BIND_OK: int = 0
const _BIND_NOT_A_NAME: int = 1
const _BIND_EMPTY: int = 2
const _BIND_NONE: int = 3
const _BIND_DUPLICATE: int = 4
const _BIND_TOO_MANY: int = 5
const _BIND_OVERLAP: int = 6
const _BIND_REASONS: Array[String] = [
	"", "a name is not a key, mouse button, gamepad button or gamepad axis direction name", "the list is empty",
	"the list has key none", "the list repeats a name", "the list is longer than the limit",
	"an overlapping action has a name of the list",
]

static var _is_initialized: bool = false
static var _node: Node = null
## Replaced on every `init`; an async operation that finds another session after `await` gives its failure value.
static var _session: RefCounted = null
static var _quit_on_go_back: bool = true

static var _move_threshold: float = 0.0
static var _long_press_ms: int = 0
static var _swipe_max_ms: int = 0
static var _swipe_min_distance: float = 0.0
static var _max_judge_pointers: int = 0
static var _max_keys_per_action: int = 0
static var _max_pad_buttons_per_action: int = 0
static var _pad_axis_wait_threshold: float = 0.0
static var _pad_axis_deadzone: float = 0.0

## Action names and their index.
static var _action_names: Array[StringName] = []
static var _action_index: Dictionary[StringName, int] = {}
static var _contexts: PackedInt32Array = PackedInt32Array()
static var _back_index: int = -1
## Bindings: `_key_stride` key binding entries and `_pad_stride` pad binding entries per action.
static var _key_stride: int = 0
static var _pad_stride: int = 0
static var _keys: PackedInt64Array = PackedInt64Array()
static var _key_counts: PackedInt32Array = PackedInt32Array()
static var _pads: PackedInt64Array = PackedInt64Array()
static var _pad_counts: PackedInt32Array = PackedInt32Array()
static var _default_keys: PackedInt64Array = PackedInt64Array()
static var _default_key_counts: PackedInt32Array = PackedInt32Array()
static var _default_pads: PackedInt64Array = PackedInt64Array()
static var _default_pad_counts: PackedInt32Array = PackedInt32Array()
## Action state: `_source_stride` input sources per action. Source `j` is key binding entry `j`, source
## `_key_stride + g * _pad_stride + j` is pad binding entry `j` of gamepad slot `g`, and the last source is the
## action's inject.
static var _source_stride: int = 0
static var _source_pressed: PackedByteArray = PackedByteArray()
static var _source_strength: PackedFloat32Array = PackedFloat32Array()
static var _pressed_counts: PackedInt32Array = PackedInt32Array()
static var _pressed_frames: PackedInt64Array = PackedInt64Array()
static var _released_frames: PackedInt64Array = PackedInt64Array()
## Whether a pressed or released frame is `_FRAME_PENDING`.
static var _frames_pending: bool = false

## Pointer slots. A slot is in use while its pointer is pressed.
static var _pointer_used: PackedByteArray = PackedByteArray()
static var _pointer_ids: PackedInt64Array = PackedInt64Array()
static var _pointer_passed: PackedByteArray = PackedByteArray()
static var _pointer_judge: PackedByteArray = PackedByteArray()
static var _pointer_moved: PackedByteArray = PackedByteArray()
static var _pointer_long_pressed: PackedByteArray = PackedByteArray()
static var _pointer_dragging: PackedByteArray = PackedByteArray()
static var _pointer_press_positions: PackedVector2Array = PackedVector2Array()
static var _pointer_positions: PackedVector2Array = PackedVector2Array()
static var _pointer_drag_positions: PackedVector2Array = PackedVector2Array()
static var _pointer_press_times: PackedInt64Array = PackedInt64Array()
static var _pointer_orders: PackedInt64Array = PackedInt64Array()
static var _press_order: int = 0
## Slot of the pointer whose release is being processed, -1 when there is none. The release processing ends when the
## viewport input dispatch of the release returns; the slot stays in use until then so that an `inject_action` of the
## UI stage still finds the passed pointer. A release a UI element took ends at the first `_input`,
## `SceneTree.physics_frame` or `SceneTree.process_frame` after it, since the engine tells nothing when the dispatch
## of a handled input returns.
static var _releasing_slot: int = -1
## Engine mouse input made from touch: whether its left button is pressed and its press passed the block stage.
static var _emulated_pressed: bool = false
static var _emulated_passed: bool = false

static var _pinch_enabled: bool = false
## Pointer slots of the pinch, -1 when there is no pinch.
static var _pinch_first: int = -1
static var _pinch_second: int = -1
static var _pinch_start_distance: float = 0.0
static var _pinch_center: Vector2 = Vector2.ZERO
static var _pinch_scale: float = 1.0

static var _device: InputDevice = InputDevice.KEYBOARD_MOUSE
static var _gamepad_family: GameData.InputPromptFamily = GameData.InputPromptFamily.GENERIC
## Gamepad family of each connected gamepad ID, decided from its `Input.get_joy_name` when it connects, so that device
## detection only reads it.
static var _gamepad_families: Dictionary[int, GameData.InputPromptFamily] = {}
static var _last_gamepad: int = -1
static var _connected_gamepads: PackedInt32Array = PackedInt32Array()
## Gamepad ID of each gamepad slot, -1 for a free slot.
static var _gamepad_slot_ids: PackedInt32Array = PackedInt32Array()
## Axis value of the last gamepad axis input of each gamepad slot and `JoyAxis`: `slot * JOY_AXIS_MAX + axis`.
static var _axis_values: PackedFloat32Array = PackedFloat32Array()

static var _has_mouse_position: bool = false
static var _mouse_position: Vector2 = Vector2.ZERO
static var _mouse_motion: Vector2 = Vector2.ZERO
static var _mouse_motion_frame: int = -1

static var _last_blocked: bool = false
static var _cancel_count: int = 0
static var _back_handler: Callable = Callable()
static var _pointer_observer: Callable = Callable()
static var _key_wait: _WAIT_SCRIPT = null
static var _pad_wait: _WAIT_SCRIPT = null
## Prompt table: `_prompt_key(family, input)` to its `input_prompt` row. The first `get_prompt` while
## `DataCore.is_loaded` builds it.
static var _prompt_rows: Dictionary[String, GameData.InputPromptRow] = {}
static var _prompt_rows_built: bool = false

## The device input `_input` handed to the UI stage, for `_unhandled_input`.
static var _pending_event: InputEvent = null
static var _pending_focus: bool = false
static var _pending_kind: int = _OTHER
static var _pending_slot: int = -1
static var _pending_position: Vector2 = Vector2.ZERO
static var _pending_axis_previous: float = 0.0
static var _pending_pad_slot: int = -1
## Passed actions of the device input of the block stage, 1 per action. A position input passes all its actions.
static var _passed: PackedByteArray = PackedByteArray()

## DEV state: the debug input handler (`InputCoreDev.set_debug_input_handler`).
static var _debug_handler: Callable = Callable()


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not _read_settings():
		return false
	if not _read_input_map():
		_reset_state()
		return false
	_session = RefCounted.new()
	_device = InputDevice.TOUCH if CoreBuildInfo.platform == "android" or CoreBuildInfo.platform == "ios" \
		else InputDevice.KEYBOARD_MOUSE
	for gamepad: int in Input.get_connected_joypads():
		_gamepad_families[gamepad] = _family_of_name(Input.get_joy_name(gamepad))
		_add_connected_gamepad(gamepad)
	var node: _NODE_SCRIPT = _NODE_SCRIPT.new()
	node.name = "InputCore"
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	node.process_priority = _PROCESS_PRIORITY
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	tree.root.add_child(node)
	_node = node
	if Input.joy_connection_changed.connect(node._on_joy_connection_changed) != OK:
		LogCore.log_error(_TAG, "init: the gamepad connection signal did not connect")
		_cleanup(true)
		return false
	if tree.physics_frame.connect(node._on_tree_frame) != OK or tree.process_frame.connect(node._on_tree_frame) != OK:
		LogCore.log_error(_TAG, "init: the scene tree frame signals did not connect")
		_cleanup(true)
		return false
	if not EventCore.subscribe(AppBackgroundEnteredEvent, node._on_app_background_entered):
		LogCore.log_error(_TAG, "init: the subscription to AppBackgroundEnteredEvent failed")
		_cleanup(true)
		return false
	_quit_on_go_back = tree.quit_on_go_back
	tree.quit_on_go_back = false
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized and _node == null:
		return
	_cleanup(true)


static func is_initialized() -> bool:
	return _is_initialized


## Whether `action` is in the action list.
static func has_action(action: StringName) -> bool:
	if not _check_initialized("has_action"):
		return false
	return _action_index.has(action)


static func is_pressed(action: StringName) -> bool:
	var index: int = _state_action("is_pressed", action)
	return index >= 0 and _pressed_counts[index] > 0


## Whether `action` was pressed in this frame. A device input press counts for the first process frame after it.
static func is_just_pressed(action: StringName) -> bool:
	var index: int = _state_action("is_just_pressed", action)
	return index >= 0 and _pressed_frames[index] == Engine.get_process_frames()


## Whether `action` was released in this frame. A device input release counts for the first process frame after it.
static func is_just_released(action: StringName) -> bool:
	var index: int = _state_action("is_just_released", action)
	return index >= 0 and _released_frames[index] == Engine.get_process_frames()


## Strength (0 to 1) of `action`: the greatest strength of its pressed sources.
static func get_strength(action: StringName) -> float:
	var index: int = _state_action("get_strength", action)
	if index < 0:
		return 0.0
	return _strength_of(index)


## x: strength of `positive_x` − strength of `negative_x`, y: likewise. A vector longer than 1 is shortened to 1.
static func get_vector(negative_x: StringName, positive_x: StringName, negative_y: StringName,
		positive_y: StringName) -> Vector2:
	var nx: int = _state_action("get_vector", negative_x)
	var px: int = _state_action("get_vector", positive_x)
	var ny: int = _state_action("get_vector", negative_y)
	var py: int = _state_action("get_vector", positive_y)
	if nx < 0 or px < 0 or ny < 0 or py < 0:
		return Vector2.ZERO
	var value: Vector2 = Vector2(_strength_of(px) - _strength_of(nx), _strength_of(py) - _strength_of(ny))
	if value.length_squared() > 1.0:
		value = value.normalized()
	return value


static func get_mouse_position() -> GetMousePositionResult:
	var result: GetMousePositionResult = GetMousePositionResult.new()
	if not _check_initialized("get_mouse_position"):
		return result
	result.ok = _has_mouse_position
	result.position = _mouse_position if _has_mouse_position else Vector2.ZERO
	return result


## Mouse motion of this frame in game coordinates.
static func get_mouse_motion() -> Vector2:
	if not _check_initialized("get_mouse_motion"):
		return Vector2.ZERO
	return _mouse_motion if _mouse_motion_frame == Engine.get_process_frames() else Vector2.ZERO


static func get_device() -> InputDevice:
	if not _check_initialized("get_device"):
		return InputDevice.TOUCH
	return _device


## Gamepad ID of the last gamepad, -1 when there is none.
static func get_last_gamepad() -> int:
	if not _check_initialized("get_last_gamepad"):
		return -1
	return _last_gamepad


## Fills `buffer` from index 0 with the connected gamepad IDs in ascending order and returns the count filled.
static func get_connected_gamepads(buffer: PackedInt32Array) -> int:
	if not _check_initialized("get_connected_gamepads"):
		return 0
	var count: int = mini(_connected_gamepads.size(), buffer.size())
	for i: int in count:
		buffer[i] = _connected_gamepads[i]
	if count < _connected_gamepads.size():
		LogCore.log_error(_TAG, "get_connected_gamepads: the buffer is smaller than the gamepad count")
	return count


static func set_pinch_enabled(enabled: bool) -> void:
	if not _check_initialized("set_pinch_enabled"):
		return
	_pinch_enabled = enabled
	if not enabled and _pinch_first >= 0:
		_cancel_pinch()


## Presses or releases the inject source of `action`. With `pointer_id`, a passed pointer's inject passes the block
## stage without `InputBlockCore.pass_action`.
static func inject_action(action: StringName, pressed: bool, strength: float, pointer_id: int = -1) -> void:
	if not _check_initialized("inject_action"):
		return
	if not _action_index.has(action):
		LogCore.log_error(_TAG, "inject_action: unknown action " + String(action))
		return
	var index: int = _action_index[action]
	var value: float = strength
	if pressed and is_nan(value):
		LogCore.log_error(_TAG, "inject_action: the strength is NaN")
		return
	if not is_nan(value) and (value < 0.0 or value > 1.0):
		LogCore.log_error(_TAG, "inject_action: the strength is out of 0 to 1")
		value = clampf(value, 0.0, 1.0)
	_block_start_check()
	var slot: int = _find_pointer(pointer_id) if pointer_id >= 0 else -1
	var passed_pointer: bool = slot >= 0 and _pointer_passed[slot] == 1
	var source: int = _source_stride - 1
	if not passed_pointer and not InputBlockCore.pass_action(action):
		# A discarded inject that releases the pressed inject source still releases it.
		if not pressed and index != _back_index:
			_release_source(index, source, false)
		return
	if index == _back_index:
		if pressed:
			_call_back_handler()
		return
	if pressed:
		_press_source(index, source, value, false)
	else:
		_release_source(index, source, false)


## Releases every pressed source, cancels drags and pinches, drops the taps, long presses and swipes not judged yet,
## ends the waiting `wait_key` and `wait_pad_button` with none, and counts the input cancel.
static func cancel_input() -> void:
	if not _check_initialized("cancel_input"):
		return
	_cancel_input()


## Input cancels since `init`.
static func get_cancel_count() -> int:
	if not _check_initialized("get_cancel_count"):
		return 0
	return _cancel_count


## Registers `callback`(→ whether it consumed the back input), called once for every back input.
static func set_back_handler(callback: Callable) -> void:
	if not _check_initialized("set_back_handler"):
		return
	if callback.is_null() or not callback.is_valid():
		LogCore.log_error(_TAG, "set_back_handler: the callback cannot be called")
		return
	_back_handler = callback


## Registers `callback`(pointer ID, pressed, game coordinates position), called for every pointer press and release
## that reaches the UI stage. An empty `Callable()` clears it.
static func set_ui_pointer_observer(callback: Callable) -> void:
	if not _check_initialized("set_ui_pointer_observer"):
		return
	if callback.is_null():
		_pointer_observer = Callable()
		return
	if not callback.is_valid():
		LogCore.log_error(_TAG, "set_ui_pointer_observer: the callback cannot be called")
		return
	_pointer_observer = callback


## Fills `buffer` from index 0 with the key and mouse button names of the key binding of `action`.
static func get_keys(action: StringName, buffer: PackedStringArray) -> int:
	return _get_binding("get_keys", action, buffer, false)


static func set_keys(action: StringName, names: PackedStringArray) -> bool:
	return _set_binding("set_keys", action, names, false)


static func reset_keys() -> void:
	if not _check_initialized("reset_keys"):
		return
	_reset_binding(false)


## Applies the saved key bindings and gamepad button bindings. `BootstrapCore` calls it after
## `LocalDataCore.load_device_file`.
static func load_keys() -> void:
	if not _check_initialized("load_keys"):
		return
	var applied_keys: bool = _load_binding(false)
	var applied_pads: bool = _load_binding(true)
	if applied_keys or applied_pads:
		_publish_prompt_changed()


## Async. The name of the next pressed key or mouse button; empty (key none) on failure.
static func wait_key() -> String:
	return await _wait("wait_key", false)


static func cancel_wait_key() -> void:
	if not _check_initialized("cancel_wait_key"):
		return
	_finish_wait(false, "")
	_finish_wait(true, "")


## Fills `buffer` from index 0 with the gamepad button and gamepad axis direction names of the gamepad button
## binding of `action`.
static func get_pad_buttons(action: StringName, buffer: PackedStringArray) -> int:
	return _get_binding("get_pad_buttons", action, buffer, true)


static func set_pad_buttons(action: StringName, names: PackedStringArray) -> bool:
	return _set_binding("set_pad_buttons", action, names, true)


static func reset_pad_buttons() -> void:
	if not _check_initialized("reset_pad_buttons"):
		return
	_reset_binding(true)


## Async. The name of the next pressed gamepad button or gamepad axis direction; empty (button none) on failure.
static func wait_pad_button() -> String:
	return await _wait("wait_pad_button", true)


static func get_prompt_family() -> GameData.InputPromptFamily:
	if not _check_initialized("get_prompt_family"):
		return GameData.InputPromptFamily.TOUCH
	return _prompt_family()


## Fills `prompt` with the input prompt of `action` in the prompt family now. `false` without a log when the
## binding has no input for the prompt family.
static func get_prompt(action: StringName, prompt: InputPrompt) -> bool:
	if not _check_initialized("get_prompt"):
		return false
	if not _action_index.has(action):
		LogCore.log_error(_TAG, "get_prompt: unknown action " + String(action))
		return false
	if prompt == null:
		LogCore.log_error(_TAG, "get_prompt: the prompt is null")
		return false
	var index: int = _action_index[action]
	var family: GameData.InputPromptFamily = _prompt_family()
	var input: String = ""
	if family == GameData.InputPromptFamily.TOUCH:
		input = String(action)
	elif family == GameData.InputPromptFamily.KEYBOARD_MOUSE:
		input = _first_key_name(index)
	else:
		input = _first_pad_name(index)
	if input.is_empty():
		return false
	if DataCore.is_loaded() and not _prompt_rows_built:
		_build_prompt_rows()
	var row: GameData.InputPromptRow = _find_prompt_row(family, input)
	if row == null and (family == GameData.InputPromptFamily.XBOX or family == GameData.InputPromptFamily.PLAY_STATION
			or family == GameData.InputPromptFamily.NINTENDO):
		row = _find_prompt_row(GameData.InputPromptFamily.GENERIC, input)
	prompt.family = family
	prompt.input = input
	prompt.icon = row.icon if row != null else ""
	prompt.name_key = row.name if row != null else ""
	return true


# --- device input


## Debug, fill area, block, device detection, key wait and UI stages of a device input (core node `_input`).
static func _on_input(event: InputEvent) -> void:
	_pending_event = null
	if not _is_initialized:
		return
	_end_release()
	var viewport: Viewport = _node.get_viewport()
	if event is InputEventMouse and event.device == InputEvent.DEVICE_ID_EMULATION:
		_on_emulated_mouse(event as InputEventMouse, viewport)
		return
	if _debug_handler_handles(event):
		viewport.set_input_as_handled()
		return
	var kind: int = _kind_of(event)
	var window_position: Vector2 = Vector2.ZERO
	var position: Vector2 = Vector2.ZERO
	if kind == _POINTER_PRESS or kind == _POINTER_MOVE or kind == _POINTER_RELEASE or kind == _MOUSE_BUTTON \
			or kind == _MOUSE_MOVE:
		window_position = viewport.get_screen_transform() * _event_position(event)
		position = ResolutionCore.window_to_game(window_position * _real_to_window_scale())
	var axis_previous: float = 0.0
	var pad_slot: int = -1
	if kind == _PAD_BUTTON:
		pad_slot = _gamepad_slot(event.device, (event as InputEventJoypadButton).pressed)
	elif kind == _PAD_AXIS:
		var motion: InputEventJoypadMotion = event as InputEventJoypadMotion
		pad_slot = _gamepad_slot(event.device, motion.axis_value != 0.0)
		if pad_slot >= 0 and motion.axis >= 0 and motion.axis < JOY_AXIS_MAX:
			axis_previous = _axis_values[pad_slot * JOY_AXIS_MAX + motion.axis]
			_axis_values[pad_slot * JOY_AXIS_MAX + motion.axis] = motion.axis_value
	var slot: int = -1
	if kind == _POINTER_PRESS:
		slot = _press_pointer_slot(_pointer_id_of(event))
	elif kind == _POINTER_MOVE or kind == _POINTER_RELEASE:
		slot = _find_pointer(_pointer_id_of(event))
	# fill area stage
	var discard: bool = kind == _POINTER_PRESS and _is_finite(position) \
		and not ResolutionCore.get_visible_game_area().has_point(position)
	# block stage
	var focus: bool = false
	if not discard:
		_block_start_check()
		_passed.fill(1)
		if kind == _POINTER_MOVE or kind == _POINTER_RELEASE:
			discard = slot < 0 or _pointer_passed[slot] == 0
		elif kind == _POINTER_PRESS or kind == _MOUSE_BUTTON or kind == _MOUSE_MOVE:
			discard = not InputBlockCore.pass_position(ResolutionCore.game_to_window(position))
		else:
			discard = not _pass_actions(event, kind, pad_slot)
			if discard and (kind == _KEY or kind == _PAD_BUTTON or kind == _PAD_AXIS):
				var owner: Control = viewport.gui_get_focus_owner()
				if owner != null and InputBlockCore.pass_focus(owner):
					discard = false
					focus = true
	if discard:
		viewport.set_input_as_handled()
		_detect_device(event)
		if kind == _POINTER_RELEASE and slot >= 0:
			_free_pointer(slot)
		# A discarded input that releases a pressed source still releases it.
		_release_world_sources(event, kind, -1, pad_slot, position)
		return
	if kind == _POINTER_PRESS and slot >= 0:
		_pointer_passed[slot] = 1
	if event is InputEventMouse:
		_track_mouse(event as InputEventMouse, position, viewport)
	_detect_device(event)
	if not focus and _key_wait_takes(event, kind, axis_previous):
		viewport.set_input_as_handled()
		return
	# A pointer press or move at an unusable position is logged before the UI stage: engine GUI treats a NaN position
	# as inside every rectangle, so the input may not reach the world stage.
	if (kind == _POINTER_PRESS or kind == _POINTER_MOVE) and not _is_finite(position):
		LogCore.log_error(_TAG, "a pointer press or move has an unusable position")
	# UI stage
	if (kind == _POINTER_PRESS or kind == _POINTER_RELEASE) and _pointer_observer.is_valid():
		_pointer_observer.call(_pointer_id_of(event), kind == _POINTER_PRESS, position)
	elif (kind == _POINTER_PRESS or kind == _POINTER_RELEASE) and not _pointer_observer.is_null():
		LogCore.log_error(_TAG, "the UI pointer observer cannot be called")
		_pointer_observer = Callable()
	_release_world_sources(event, kind, slot, pad_slot, position)
	_pending_event = event
	_pending_focus = focus
	_pending_kind = kind
	_pending_slot = slot
	_pending_position = position
	_pending_axis_previous = axis_previous
	_pending_pad_slot = pad_slot


## World stage of a device input the UI stage did not consume (core node `_unhandled_input`).
static func _on_unhandled_input(event: InputEvent) -> void:
	if not _is_initialized or event != _pending_event:
		return
	_pending_event = null
	if _pending_focus:
		return
	var kind: int = _pending_kind
	if kind == _POINTER_RELEASE:
		_end_release()
		return
	if kind == _POINTER_PRESS:
		if event is InputEventMouseButton:
			_press_key_entry(-MOUSE_BUTTON_LEFT)
		if _pending_slot >= 0 and _is_initialized:
			_judge_press(_pending_slot, _pending_position)
	elif kind == _POINTER_MOVE:
		if _pending_slot >= 0:
			_judge_move(_pending_slot, _pending_position)
	elif kind == _MOUSE_BUTTON:
		var button: InputEventMouseButton = event as InputEventMouseButton
		if button.pressed:
			_press_key_entry(-button.button_index)
	elif kind == _KEY:
		var key: InputEventKey = event as InputEventKey
		if key.pressed and not key.echo and _key_code_of(key) != KEY_NONE:
			_press_key_entry(_key_code_of(key))
	elif kind == _PAD_BUTTON:
		var pad_button: InputEventJoypadButton = event as InputEventJoypadButton
		if pad_button.pressed:
			_press_pad_entry(pad_button.button_index, _pending_pad_slot)
	elif kind == _PAD_AXIS:
		var motion: InputEventJoypadMotion = event as InputEventJoypadMotion
		_press_axis(motion.axis, motion.axis_value, _pending_axis_previous, _pending_pad_slot)


## Engine mouse input made from touch: it reaches the UI stage when its pointer passes the fill area and block
## stages. The moves and the release after its left button press run the block start check first, and pass when
## that press passed both stages and no input cancel came after it. It is not used for device detection, key wait,
## mouse position or the world stage.
static func _on_emulated_mouse(event: InputEventMouse, viewport: Viewport) -> void:
	var window_position: Vector2 = viewport.get_screen_transform() * event.position
	var position: Vector2 = ResolutionCore.window_to_game(window_position * _real_to_window_scale())
	var discard: bool = false
	if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		if (event as InputEventMouseButton).pressed:
			_emulated_pressed = true
			_emulated_passed = false
			discard = _is_finite(position) and not ResolutionCore.get_visible_game_area().has_point(position)
			if not discard:
				_block_start_check()
				discard = not InputBlockCore.pass_position(ResolutionCore.game_to_window(position))
			_emulated_passed = not discard
		else:
			_block_start_check()
			discard = not _emulated_passed
			_emulated_pressed = false
			_emulated_passed = false
	elif event is InputEventMouseMotion and _emulated_pressed:
		_block_start_check()
		discard = not _emulated_passed
	else:
		_block_start_check()
		discard = not InputBlockCore.pass_position(ResolutionCore.game_to_window(position))
	if discard:
		viewport.set_input_as_handled()


## `SceneTree.physics_frame` and `SceneTree.process_frame`, which come before every node's physics and process
## callbacks of the frame. `Engine.get_process_frames()` there is already the number of the frame's process step.
static func _on_tree_frame() -> void:
	if _is_initialized:
		_end_release()
		_stamp_pending_frames()


static func _on_frame() -> void:
	if not _is_initialized:
		return
	_stamp_pending_frames()
	_block_start_check()
	var now: int = TimeCore.get_real_time()
	for slot: int in _pointer_used.size():
		if _pointer_used[slot] == 1 and _pointer_judge[slot] == 1 and _pointer_moved[slot] == 0 \
				and _pointer_long_pressed[slot] == 0 and slot != _pinch_first and slot != _pinch_second \
				and now - _pointer_press_times[slot] >= _long_press_ms:
			_pointer_long_pressed[slot] = 1
			var event: LongPressEvent = EventCore.acquire(LongPressEvent) as LongPressEvent
			if event != null:
				event.pointer_id = _pointer_ids[slot]
				event.position = _pointer_positions[slot]
				EventCore.publish(event)
			if not _is_initialized:
				return


static func _on_focus_lost() -> void:
	if _is_initialized:
		_cancel_input()


## A platform back button request: one `back` press inject.
static func _on_platform_back() -> void:
	if _is_initialized:
		inject_action(_BACK, true, 1.0)


static func _on_node_exit_tree(node: Node) -> void:
	if node == _node:
		_cleanup(false)


static func _on_gamepad_connection(gamepad: int, connected: bool) -> void:
	if not _is_initialized:
		return
	_change_gamepad_connection(gamepad, connected, Input.get_joy_name(gamepad) if connected else "")


## A gamepad connection or disconnection the engine told. `joy_name` is the engine's name of a connected gamepad, which
## decides its gamepad family.
static func _change_gamepad_connection(gamepad: int, connected: bool, joy_name: String) -> void:
	var changed: bool = false
	if connected:
		_gamepad_families[gamepad] = _family_of_name(joy_name)
		changed = _add_connected_gamepad(gamepad)
	else:
		_gamepad_families.erase(gamepad)
		var pad_slot: int = _gamepad_slot(gamepad, false)
		if pad_slot >= 0:
			for action: int in _action_names.size():
				for j: int in _pad_stride:
					_release_source(action, _pad_source_index(pad_slot, j), false)
			for axis: int in JOY_AXIS_MAX:
				_axis_values[pad_slot * JOY_AXIS_MAX + axis] = 0.0
			_gamepad_slot_ids[pad_slot] = -1
		if _last_gamepad == gamepad:
			_last_gamepad = -1
		var at: int = _connected_gamepads.find(gamepad)
		if at >= 0:
			_connected_gamepads.remove_at(at)
			changed = true
	if changed:
		var event: GamepadConnectionChangedEvent = \
			EventCore.acquire(GamepadConnectionChangedEvent) as GamepadConnectionChangedEvent
		if event != null:
			event.gamepad_id = gamepad
			event.connected = connected
			EventCore.publish(event)


# --- stages


static func _kind_of(event: InputEvent) -> int:
	if event is InputEventScreenTouch:
		return _POINTER_PRESS if (event as InputEventScreenTouch).pressed else _POINTER_RELEASE
	if event is InputEventScreenDrag:
		return _POINTER_MOVE
	if event is InputEventMouseButton:
		var button: InputEventMouseButton = event as InputEventMouseButton
		if button.button_index == MOUSE_BUTTON_LEFT:
			return _POINTER_PRESS if button.pressed else _POINTER_RELEASE
		return _MOUSE_BUTTON
	if event is InputEventMouseMotion:
		return _POINTER_MOVE if _find_pointer(_MOUSE_POINTER_ID) >= 0 else _MOUSE_MOVE
	if event is InputEventKey:
		return _KEY
	if event is InputEventJoypadButton:
		return _PAD_BUTTON
	if event is InputEventJoypadMotion:
		return _PAD_AXIS
	return _OTHER


## Per axis, `ResolutionCore` window pixels per real window pixel. The engine gives input positions in real window
## pixels and draws the window area on the real window. `ResolutionCore` window pixels are those of the window size it
## computes with, which is the real window size except under a DEV test screen (`ResolutionCoreDev.set_test_screen`):
## there a real window pixel is (test window size ÷ real window size) window pixels, so that an input lands on what is
## drawn under it. (1, 1) while either size has a side of 0.
static func _real_to_window_scale() -> Vector2:
	var real: Vector2i = _node.get_tree().root.size if _node != null and _node.is_inside_tree() else Vector2i.ZERO
	var window: Vector2i = ResolutionCore.get_window_size()
	if real.x <= 0 or real.y <= 0 or window.x <= 0 or window.y <= 0:
		return Vector2.ONE
	return Vector2(float(window.x) / real.x, float(window.y) / real.y)


static func _event_position(event: InputEvent) -> Vector2:
	if event is InputEventMouse:
		return (event as InputEventMouse).position
	if event is InputEventScreenTouch:
		return (event as InputEventScreenTouch).position
	if event is InputEventScreenDrag:
		return (event as InputEventScreenDrag).position
	return Vector2.ZERO


static func _pointer_id_of(event: InputEvent) -> int:
	if event is InputEventScreenTouch:
		return (event as InputEventScreenTouch).index
	if event is InputEventScreenDrag:
		return (event as InputEventScreenDrag).index
	return _MOUSE_POINTER_ID


static func _key_code_of(event: InputEventKey) -> int:
	return event.keycode if event.keycode != KEY_NONE else event.physical_keycode


static func _debug_handler_handles(event: InputEvent) -> bool:
	if _debug_handler.is_null():
		return false
	if not _debug_handler.is_valid():
		LogCore.log_error(_TAG, "the debug input handler cannot be called")
		_debug_handler = Callable()
		return false
	return _is_true(_debug_handler.call(event))


## The block start check: an input cancel when the blocked state starts.
static func _block_start_check() -> void:
	var blocked: bool = InputBlockCore.is_blocked()
	var started: bool = blocked and not _last_blocked
	_last_blocked = blocked
	if started:
		_cancel_input()


## Block stage of an input without a position: puts in `_passed` the actions it presses or releases whose
## `InputBlockCore.pass_action` is `true` (passed actions). `false` when it presses or releases actions and none passes,
## or when it presses or releases no action in the blocked state.
static func _pass_actions(event: InputEvent, kind: int, pad_slot: int) -> bool:
	var matched: bool = false
	var passed: bool = false
	for action: int in _action_names.size():
		var hit: bool = false
		if kind == _KEY:
			hit = _key_source(action, _key_code_of(event as InputEventKey)) >= 0
		elif kind == _PAD_BUTTON:
			hit = _pad_source(action, (event as InputEventJoypadButton).button_index) >= 0
		elif kind == _PAD_AXIS:
			var motion: InputEventJoypadMotion = event as InputEventJoypadMotion
			hit = _axis_hits(action, motion.axis, motion.axis_value, pad_slot)
		if not hit:
			_passed[action] = 0
			continue
		matched = true
		if InputBlockCore.pass_action(_action_names[action]):
			passed = true
		else:
			_passed[action] = 0
	return passed if matched else not InputBlockCore.is_blocked()


## Whether a gamepad axis input of gamepad slot `pad_slot` presses `action` (a direction of `value` with strength above
## 0 is in its binding) or releases it (its source of that gamepad for a direction whose strength is 0 is pressed).
static func _axis_hits(action: int, axis: int, value: float, pad_slot: int) -> bool:
	for direction: int in 2:
		var positive: bool = direction == 0
		var source: int = _pad_source(action, _axis_entry(axis, positive))
		if source < 0:
			continue
		if _direction_strength(value, positive) > 0.0:
			return true
		if pad_slot >= 0 and _source_pressed[action * _source_stride + _pad_source_index(pad_slot, source)] == 1:
			return true
	return false


## Device detection: the input device becomes the device of the input, except for a gamepad axis input that presses
## no action.
static func _detect_device(event: InputEvent) -> void:
	var device: InputDevice = InputDevice.KEYBOARD_MOUSE
	if event is InputEventScreenTouch or event is InputEventScreenDrag:
		device = InputDevice.TOUCH
	elif event is InputEventMouse or event is InputEventKey:
		device = InputDevice.KEYBOARD_MOUSE
	elif event is InputEventJoypadButton:
		device = InputDevice.GAMEPAD
	elif event is InputEventJoypadMotion:
		var motion: InputEventJoypadMotion = event as InputEventJoypadMotion
		if not _axis_presses_action(motion.axis, motion.axis_value):
			return
		device = InputDevice.GAMEPAD
	else:
		return
	var previous_family: GameData.InputPromptFamily = _prompt_family()
	var changed: bool = device != _device
	_device = device
	if device == InputDevice.GAMEPAD:
		_last_gamepad = event.device
		_gamepad_family = _gamepad_families[event.device] if _gamepad_families.has(event.device) \
			else GameData.InputPromptFamily.GENERIC
	if changed:
		_publish_device_changed()
	if _prompt_family() != previous_family:
		_publish_prompt_changed()


## Key wait stage: `true` when a waiting `wait_key` or `wait_pad_button` takes the input.
static func _key_wait_takes(event: InputEvent, kind: int, axis_previous: float) -> bool:
	if _key_wait != null:
		if kind == _KEY:
			var key: InputEventKey = event as InputEventKey
			var code: int = _key_code_of(key)
			if key.pressed and not key.echo and code != KEY_NONE:
				_finish_wait(false, OS.get_keycode_string(code))
				return true
		elif kind == _POINTER_PRESS or kind == _MOUSE_BUTTON:
			var button: InputEventMouseButton = event as InputEventMouseButton
			if button != null and button.pressed and button.button_index >= 1 \
					and button.button_index <= _MOUSE_BUTTON_NAMES.size():
				_finish_wait(false, _MOUSE_BUTTON_NAMES[button.button_index - 1])
				return true
	if _pad_wait != null:
		if kind == _PAD_BUTTON:
			var pad_button: InputEventJoypadButton = event as InputEventJoypadButton
			if pad_button.pressed and pad_button.button_index >= 0 \
					and pad_button.button_index < _PAD_BUTTON_NAMES.size():
				_finish_wait(true, _PAD_BUTTON_NAMES[pad_button.button_index])
				return true
		elif kind == _PAD_AXIS:
			var motion: InputEventJoypadMotion = event as InputEventJoypadMotion
			if motion.axis >= 0 and motion.axis < _PAD_AXIS_NAMES.size():
				for direction: int in 2:
					var positive: bool = direction == 0
					if not positive and _is_trigger(motion.axis):
						continue
					var before: float = _direction_strength(axis_previous, positive)
					var now: float = _direction_strength(motion.axis_value, positive)
					if before < _pad_axis_wait_threshold and now >= _pad_axis_wait_threshold:
						_finish_wait(true, _pad_entry_name(_axis_entry(motion.axis, positive)))
						return true
	return false


## Releases, before the UI stage, the sources and the pointer a releasing input releases.
static func _release_world_sources(event: InputEvent, kind: int, slot: int, pad_slot: int, position: Vector2) -> void:
	if kind == _POINTER_RELEASE:
		if event is InputEventMouseButton:
			_release_key_entry(-MOUSE_BUTTON_LEFT)
		if slot >= 0:
			# An OS pointer cancel is the release of the pointer, and gesture judgment does a pointer cancel instead.
			var touch: InputEventScreenTouch = event as InputEventScreenTouch
			if touch != null and touch.canceled:
				_pointer_cancel(slot)
			_releasing_slot = slot
			_judge_release(slot, position)
	elif kind == _MOUSE_BUTTON:
		var button: InputEventMouseButton = event as InputEventMouseButton
		if not button.pressed:
			_release_key_entry(-button.button_index)
	elif kind == _KEY:
		var key: InputEventKey = event as InputEventKey
		if not key.pressed:
			_release_key_entry(_key_code_of(key))
	elif kind == _PAD_BUTTON:
		var pad_button: InputEventJoypadButton = event as InputEventJoypadButton
		if not pad_button.pressed:
			_release_pad_entry(pad_button.button_index, pad_slot)
	elif kind == _PAD_AXIS:
		var motion: InputEventJoypadMotion = event as InputEventJoypadMotion
		if _direction_strength(motion.axis_value, true) <= 0.0:
			_release_pad_entry(_axis_entry(motion.axis, true), pad_slot)
		if _direction_strength(motion.axis_value, false) <= 0.0:
			_release_pad_entry(_axis_entry(motion.axis, false), pad_slot)


static func _track_mouse(event: InputEventMouse, position: Vector2, viewport: Viewport) -> void:
	if _is_finite(position):
		_has_mouse_position = true
		_mouse_position = position
	if event is InputEventMouseMotion:
		var window_motion: Vector2 = viewport.get_screen_transform().basis_xform((event as InputEventMouseMotion).relative)
		var motion: Vector2 = ResolutionCore.window_to_game(window_motion * _real_to_window_scale())
		if not _is_finite(motion):
			return
		var frame: int = Engine.get_process_frames()
		if _mouse_motion_frame != frame:
			_mouse_motion_frame = frame
			_mouse_motion = Vector2.ZERO
		_mouse_motion += motion


# --- back and action state


## Calls the back handler for a back input. `true` when it consumed the back input.
static func _call_back_handler() -> bool:
	if _back_handler.is_null():
		return false
	if not _back_handler.is_valid():
		LogCore.log_error(_TAG, "the back handler cannot be called")
		_back_handler = Callable()
		return false
	return _is_true(_back_handler.call())


## World stage of a key or mouse button press: back handling, then the action state, for the passed actions.
static func _press_key_entry(entry: int) -> void:
	if _back_index >= 0 and _passed[_back_index] == 1 and _key_source(_back_index, entry) >= 0 \
			and _call_back_handler():
		return
	for action: int in _action_names.size():
		if action == _back_index or _passed[action] == 0:
			continue
		var source: int = _key_source(action, entry)
		if source >= 0:
			_press_source(action, source, 1.0, true)


static func _release_key_entry(entry: int) -> void:
	for action: int in _action_names.size():
		var source: int = _key_source(action, entry)
		if source >= 0:
			_release_source(action, source, true)


## World stage of a gamepad button press of gamepad slot `pad_slot`, for the passed actions.
static func _press_pad_entry(entry: int, pad_slot: int) -> void:
	if _back_index >= 0 and _passed[_back_index] == 1 and _pad_source(_back_index, entry) >= 0 \
			and _call_back_handler():
		return
	if pad_slot < 0:
		return
	for action: int in _action_names.size():
		if action == _back_index or _passed[action] == 0:
			continue
		var source: int = _pad_source(action, entry)
		if source >= 0:
			_press_source(action, _pad_source_index(pad_slot, source), 1.0, true)


static func _release_pad_entry(entry: int, pad_slot: int) -> void:
	if pad_slot < 0:
		return
	for action: int in _action_names.size():
		var source: int = _pad_source(action, entry)
		if source >= 0:
			_release_source(action, _pad_source_index(pad_slot, source), true)


## World stage of a gamepad axis input of gamepad slot `pad_slot`, for the passed actions: a direction whose strength
## rises from 0 is a press of the actions that have it, and a pressed direction takes the new strength.
static func _press_axis(axis: int, value: float, previous: float, pad_slot: int) -> void:
	if _back_index >= 0 and _passed[_back_index] == 1:
		for direction: int in 2:
			var positive: bool = direction == 0
			if _direction_strength(value, positive) > 0.0 and _direction_strength(previous, positive) <= 0.0 \
					and _pad_source(_back_index, _axis_entry(axis, positive)) >= 0 and _call_back_handler():
				return
	if pad_slot < 0:
		return
	for direction: int in 2:
		var positive: bool = direction == 0
		var strength: float = _direction_strength(value, positive)
		if strength <= 0.0:
			continue
		var entry: int = _axis_entry(axis, positive)
		for action: int in _action_names.size():
			if action == _back_index or _passed[action] == 0:
				continue
			var source: int = _pad_source(action, entry)
			if source >= 0:
				_press_source(action, _pad_source_index(pad_slot, source), strength, true)


static func _axis_presses_action(axis: int, value: float) -> bool:
	for direction: int in 2:
		var positive: bool = direction == 0
		if _direction_strength(value, positive) <= 0.0:
			continue
		var entry: int = _axis_entry(axis, positive)
		for action: int in _action_names.size():
			if _pad_source(action, entry) >= 0:
				return true
	return false


## `device`: whether a device input presses the source. Its pressed frame is then stamped before the next process
## callbacks.
static func _press_source(action: int, source: int, strength: float, device: bool) -> void:
	var at: int = action * _source_stride + source
	if not device:
		_stamp_pending_frames_of(action)
	if _source_pressed[at] == 0:
		_source_pressed[at] = 1
		_pressed_counts[action] += 1
		if _pressed_counts[action] == 1:
			_pressed_frames[action] = _frame_of(device)
	_source_strength[at] = strength


## `device`: whether a device input releases the source. Its released frame is then stamped before the next process
## callbacks.
static func _release_source(action: int, source: int, device: bool) -> void:
	var at: int = action * _source_stride + source
	if _source_pressed[at] == 0:
		return
	if not device:
		_stamp_pending_frames_of(action)
	_source_pressed[at] = 0
	_source_strength[at] = 0.0
	_pressed_counts[action] -= 1
	if _pressed_counts[action] == 0:
		_released_frames[action] = _frame_of(device)


## Pressed or released frame of a press or release now: `_FRAME_PENDING` for a device input, else this frame.
static func _frame_of(device: bool) -> int:
	if device:
		_frames_pending = true
		return _FRAME_PENDING
	return Engine.get_process_frames()


## Stamps this frame on the pending pressed and released frames of `action`, for a press or release of the action that
## is not a device input, whether or not it changes the count of pressed sources: the pending one is not seen after it.
static func _stamp_pending_frames_of(action: int) -> void:
	var frame: int = Engine.get_process_frames()
	if _pressed_frames[action] == _FRAME_PENDING:
		_pressed_frames[action] = frame
	if _released_frames[action] == _FRAME_PENDING:
		_released_frames[action] = frame


## Stamps the pending pressed and released frames with the number of this frame's process step.
static func _stamp_pending_frames() -> void:
	if not _frames_pending:
		return
	_frames_pending = false
	var frame: int = Engine.get_process_frames()
	for action: int in _pressed_frames.size():
		if _pressed_frames[action] == _FRAME_PENDING:
			_pressed_frames[action] = frame
		if _released_frames[action] == _FRAME_PENDING:
			_released_frames[action] = frame


static func _release_action(action: int) -> void:
	for source: int in _source_stride:
		_release_source(action, source, false)


static func _strength_of(action: int) -> float:
	var strength: float = 0.0
	var start: int = action * _source_stride
	for source: int in _source_stride:
		if _source_pressed[start + source] == 1:
			strength = maxf(strength, _source_strength[start + source])
	return strength


## Index of the key binding entry `entry` of `action`, or -1.
static func _key_source(action: int, entry: int) -> int:
	var start: int = action * _key_stride
	for j: int in _key_counts[action]:
		if _keys[start + j] == entry:
			return j
	return -1


## Index of the pad binding entry `entry` of `action`, or -1.
static func _pad_source(action: int, entry: int) -> int:
	var start: int = action * _pad_stride
	for j: int in _pad_counts[action]:
		if _pads[start + j] == entry:
			return j
	return -1


static func _axis_entry(axis: int, positive: bool) -> int:
	return _AXIS_BASE + axis * 2 + (1 if positive else 0)


## Source index of pad binding entry `entry_index` of gamepad slot `pad_slot`.
static func _pad_source_index(pad_slot: int, entry_index: int) -> int:
	return _key_stride + pad_slot * _pad_stride + entry_index


## Gamepad slot of gamepad ID `gamepad`, -1 when it has none. With `take`, a gamepad without a slot takes a free slot,
## or a slot whose gamepad has no pressed source and no nonzero axis value.
static func _gamepad_slot(gamepad: int, take: bool) -> int:
	if gamepad < 0:
		return -1
	for pad_slot: int in _GAMEPAD_SLOTS:
		if _gamepad_slot_ids[pad_slot] == gamepad:
			return pad_slot
	if not take:
		return -1
	var free: int = _gamepad_slot_ids.find(-1)
	if free < 0:
		for pad_slot: int in _GAMEPAD_SLOTS:
			if _is_gamepad_slot_idle(pad_slot):
				free = pad_slot
				break
	if free < 0:
		LogCore.log_error(_TAG, "gamepad " + str(gamepad) + " has no gamepad slot: " + str(_GAMEPAD_SLOTS) \
			+ " other gamepads hold input")
		return -1
	_gamepad_slot_ids[free] = gamepad
	for axis: int in JOY_AXIS_MAX:
		_axis_values[free * JOY_AXIS_MAX + axis] = 0.0
	return free


static func _is_gamepad_slot_idle(pad_slot: int) -> bool:
	for axis: int in JOY_AXIS_MAX:
		if _axis_values[pad_slot * JOY_AXIS_MAX + axis] != 0.0:
			return false
	for action: int in _action_names.size():
		for j: int in _pad_stride:
			if _source_pressed[action * _source_stride + _pad_source_index(pad_slot, j)] == 1:
				return false
	return true


## Strength of a gamepad axis direction: the size of `value` in that direction, 0 below `InputCore.padAxisDeadzone`.
static func _direction_strength(value: float, positive: bool) -> float:
	if is_nan(value):
		return 0.0
	var size: float = maxf(value, 0.0) if positive else maxf(-value, 0.0)
	return size if size >= _pad_axis_deadzone else 0.0


static func _is_trigger(axis: int) -> bool:
	return axis == JOY_AXIS_TRIGGER_LEFT or axis == JOY_AXIS_TRIGGER_RIGHT


## Index of `action` for an action state operation; -1 with an error log for an unknown action or `back`.
static func _state_action(operation: String, action: StringName) -> int:
	if not _check_initialized(operation):
		return -1
	if not _action_index.has(action):
		LogCore.log_error(_TAG, operation + ": unknown action " + String(action))
		return -1
	if action == _BACK:
		LogCore.log_error(_TAG, operation + ": back has no action state")
		return -1
	return _action_index[action]


# --- pointers and gestures


static func _find_pointer(pointer_id: int) -> int:
	for slot: int in _pointer_used.size():
		if _pointer_used[slot] == 1 and _pointer_ids[slot] == pointer_id:
			return slot
	return -1


## The slot of a pointer press. A press of a pressed pointer ID first does a pointer cancel of its earlier press, which
## stops being a passed pointer.
static func _press_pointer_slot(pointer_id: int) -> int:
	var slot: int = _find_pointer(pointer_id)
	if slot >= 0:
		if _pointer_judge[slot] == 1:
			_pointer_cancel(slot)
		_free_pointer(slot)
	for free: int in _pointer_used.size():
		if _pointer_used[free] == 0:
			_pointer_used[free] = 1
			_pointer_ids[free] = pointer_id
			return free
	return -1


## Ends the release processing: frees the slot of the released pointer (`_unhandled_input` of the release when no UI
## element took it, else the next `_input`, `SceneTree.physics_frame`, `SceneTree.process_frame` or the return of
## `inject_device_input`).
static func _end_release() -> void:
	if _releasing_slot < 0:
		return
	var slot: int = _releasing_slot
	_releasing_slot = -1
	if slot < _pointer_used.size():
		_free_pointer(slot)


static func _free_pointer(slot: int) -> void:
	if slot == _releasing_slot:
		_releasing_slot = -1
	_pointer_used[slot] = 0
	_pointer_ids[slot] = -1
	_pointer_passed[slot] = 0
	_pointer_judge[slot] = 0
	_pointer_moved[slot] = 0
	_pointer_long_pressed[slot] = 0
	_pointer_dragging[slot] = 0


static func _judge_count() -> int:
	var count: int = 0
	for slot: int in _pointer_used.size():
		if _pointer_used[slot] == 1 and _pointer_judge[slot] == 1:
			count += 1
	return count


## World stage of a pointer press: the pointer becomes a judge pointer, and with pinch on it may start a pinch.
static func _judge_press(slot: int, position: Vector2) -> void:
	if _pointer_used[slot] == 0 or _pointer_judge[slot] == 1 or not _is_finite(position):
		return
	if _judge_count() >= _max_judge_pointers:
		return
	_pointer_judge[slot] = 1
	_pointer_moved[slot] = 0
	_pointer_long_pressed[slot] = 0
	_pointer_dragging[slot] = 0
	_pointer_press_positions[slot] = position
	_pointer_positions[slot] = position
	_pointer_drag_positions[slot] = position
	_pointer_press_times[slot] = TimeCore.get_real_time()
	_pointer_orders[slot] = _press_order
	_press_order += 1
	if not _pinch_enabled or _pinch_first >= 0:
		return
	var first: int = -1
	for other: int in _pointer_used.size():
		if other != slot and _pointer_used[other] == 1 and _pointer_judge[other] == 1 \
				and (first < 0 or _pointer_orders[other] < _pointer_orders[first]):
			first = other
	if first < 0:
		return
	var first_order: int = _pointer_orders[first]
	var order: int = _pointer_orders[slot]
	if _pointer_dragging[first] == 1:
		_pointer_dragging[first] = 0
		_publish_drag(first, GesturePhase.CANCEL, _pointer_drag_positions[first], Vector2.ZERO)
	if not _is_initialized or not _pinch_enabled or _pinch_first >= 0:
		return
	if _pointer_judge[first] == 0 or _pointer_judge[slot] == 0 or _pointer_orders[first] != first_order \
			or _pointer_orders[slot] != order:
		return
	_pinch_first = first
	_pinch_second = slot
	_pinch_start_distance = _pointer_positions[first].distance_to(position)
	_pinch_center = (_pointer_positions[first] + position) * 0.5
	_pinch_scale = 1.0
	_publish_pinch(GesturePhase.START)


## World stage of a pointer move.
static func _judge_move(slot: int, position: Vector2) -> void:
	if _pointer_used[slot] == 0 or _pointer_judge[slot] == 0 or not _is_finite(position):
		return
	if position == _pointer_positions[slot]:
		return
	_pointer_positions[slot] = position
	if slot == _pinch_first or slot == _pinch_second:
		_update_pinch()
		_publish_pinch(GesturePhase.MOVE)
		return
	if _pointer_moved[slot] == 0 and position.distance_to(_pointer_press_positions[slot]) > _move_threshold:
		_pointer_moved[slot] = 1
		_pointer_dragging[slot] = 1
		_pointer_drag_positions[slot] = position
		_publish_drag(slot, GesturePhase.START, position, position - _pointer_press_positions[slot])
	elif _pointer_dragging[slot] == 1:
		var delta: Vector2 = position - _pointer_drag_positions[slot]
		_pointer_drag_positions[slot] = position
		_publish_drag(slot, GesturePhase.MOVE, position, delta)


## Pointer release of a judge pointer: pinch end, drag end and swipe, or tap.
static func _judge_release(slot: int, release_position: Vector2) -> void:
	if _pointer_judge[slot] == 0:
		return
	var position: Vector2 = release_position
	if not _is_finite(position):
		LogCore.log_error(_TAG, "a pointer release has an unusable position")
		position = _pointer_positions[slot]
	if slot == _pinch_first or slot == _pinch_second:
		var other: int = _pinch_second if slot == _pinch_first else _pinch_first
		_pointer_positions[slot] = position
		_update_pinch()
		_pinch_first = -1
		_pinch_second = -1
		_pointer_judge[slot] = 0
		_pointer_judge[other] = 0
		_publish_pinch(GesturePhase.END)
		return
	var id: int = _pointer_ids[slot]
	var order: int = _pointer_orders[slot]
	if _pointer_moved[slot] == 0 and position.distance_to(_pointer_press_positions[slot]) > _move_threshold:
		_pointer_moved[slot] = 1
		_pointer_dragging[slot] = 1
		_pointer_drag_positions[slot] = position
		_pointer_positions[slot] = position
		_publish_drag(slot, GesturePhase.START, position, position - _pointer_press_positions[slot])
		if not _still_judge(slot, id, order):
			return
	if _pointer_dragging[slot] == 1:
		var delta: Vector2 = position - _pointer_drag_positions[slot]
		_pointer_dragging[slot] = 0
		_pointer_drag_positions[slot] = position
		_pointer_positions[slot] = position
		var start: Vector2 = _pointer_press_positions[slot]
		var elapsed: int = TimeCore.get_real_time() - _pointer_press_times[slot]
		_publish_drag(slot, GesturePhase.END, position, delta)
		if _still_judge(slot, id, order) and elapsed <= _swipe_max_ms \
				and start.distance_to(position) >= _swipe_min_distance:
			var event: SwipeEvent = EventCore.acquire(SwipeEvent) as SwipeEvent
			if event != null:
				event.pointer_id = id
				event.start_position = start
				event.end_position = position
				EventCore.publish(event)
	elif _pointer_moved[slot] == 0 and _pointer_long_pressed[slot] == 0:
		var event: TapEvent = EventCore.acquire(TapEvent) as TapEvent
		if event != null:
			event.pointer_id = id
			event.position = position
			EventCore.publish(event)
	if _is_initialized and _pointer_orders[slot] == order:
		_pointer_judge[slot] = 0


static func _still_judge(slot: int, id: int, order: int) -> bool:
	return _is_initialized and _pointer_used[slot] == 1 and _pointer_ids[slot] == id \
		and _pointer_orders[slot] == order and _pointer_judge[slot] == 1


## Pointer cancel: drag or pinch `CANCEL` for this pointer only, and it stops being a judge pointer.
static func _pointer_cancel(slot: int) -> void:
	if slot == _pinch_first or slot == _pinch_second:
		_cancel_pinch()
	elif _pointer_dragging[slot] == 1:
		_pointer_dragging[slot] = 0
		_pointer_judge[slot] = 0
		_publish_drag(slot, GesturePhase.CANCEL, _pointer_drag_positions[slot], Vector2.ZERO)
	_pointer_judge[slot] = 0


static func _cancel_pinch() -> void:
	if _pinch_first < 0:
		return
	_pointer_judge[_pinch_first] = 0
	_pointer_judge[_pinch_second] = 0
	_pinch_first = -1
	_pinch_second = -1
	_publish_pinch(GesturePhase.CANCEL)


static func _update_pinch() -> void:
	var first: Vector2 = _pointer_positions[_pinch_first]
	var second: Vector2 = _pointer_positions[_pinch_second]
	_pinch_center = (first + second) * 0.5
	_pinch_scale = 1.0 if _pinch_start_distance == 0.0 else first.distance_to(second) / _pinch_start_distance


static func _cancel_input() -> void:
	_cancel_count += 1
	for action: int in _action_names.size():
		_release_action(action)
	_emulated_passed = false
	_cancel_pinch()
	for slot: int in _pointer_used.size():
		if not _is_initialized:
			return
		if _pointer_used[slot] == 0:
			continue
		_pointer_passed[slot] = 0
		if _pointer_dragging[slot] == 1:
			_pointer_dragging[slot] = 0
			_pointer_judge[slot] = 0
			_publish_drag(slot, GesturePhase.CANCEL, _pointer_drag_positions[slot], Vector2.ZERO)
		_pointer_judge[slot] = 0
	_finish_wait(false, "")
	_finish_wait(true, "")


static func _publish_drag(slot: int, phase: GesturePhase, position: Vector2, delta: Vector2) -> void:
	var event: DragEvent = EventCore.acquire(DragEvent) as DragEvent
	if event == null:
		return
	event.pointer_id = _pointer_ids[slot]
	event.phase = phase
	event.start_position = _pointer_press_positions[slot]
	event.position = position
	event.delta = delta
	EventCore.publish(event)


static func _publish_pinch(phase: GesturePhase) -> void:
	var event: PinchEvent = EventCore.acquire(PinchEvent) as PinchEvent
	if event == null:
		return
	event.phase = phase
	event.center = _pinch_center
	event.scale = _pinch_scale
	EventCore.publish(event)


# --- input device and prompt


static func _prompt_family() -> GameData.InputPromptFamily:
	if _device == InputDevice.TOUCH:
		return GameData.InputPromptFamily.TOUCH
	if _device == InputDevice.KEYBOARD_MOUSE:
		return GameData.InputPromptFamily.KEYBOARD_MOUSE
	return _gamepad_family


static func _family_of_name(joy_name: String) -> GameData.InputPromptFamily:
	var lower: String = joy_name.to_lower()
	for part: String in _XBOX_NAMES:
		if lower.contains(part):
			return GameData.InputPromptFamily.XBOX
	for part: String in _PLAY_STATION_NAMES:
		if lower.contains(part):
			return GameData.InputPromptFamily.PLAY_STATION
	for part: String in _NINTENDO_NAMES:
		if lower.contains(part):
			return GameData.InputPromptFamily.NINTENDO
	return GameData.InputPromptFamily.GENERIC


static func _publish_device_changed() -> void:
	var event: InputDeviceChangedEvent = EventCore.acquire(InputDeviceChangedEvent) as InputDeviceChangedEvent
	if event == null:
		return
	event.device = _device
	EventCore.publish(event)


static func _publish_prompt_changed() -> void:
	var event: InputPromptChangedEvent = EventCore.acquire(InputPromptChangedEvent) as InputPromptChangedEvent
	if event == null:
		return
	event.family = _prompt_family()
	EventCore.publish(event)


## Sets the input device (`InputCoreDev.set_test_device`).
static func _set_device(device: InputDevice) -> void:
	var previous_family: GameData.InputPromptFamily = _prompt_family()
	if device == _device:
		return
	_device = device
	_publish_device_changed()
	if _prompt_family() != previous_family:
		_publish_prompt_changed()


## Sets the gamepad family (`InputCoreDev.set_test_gamepad_family`); the next gamepad input decides it again.
static func _set_gamepad_family(family: GameData.InputPromptFamily) -> void:
	var previous_family: GameData.InputPromptFamily = _prompt_family()
	_gamepad_family = family
	if _prompt_family() != previous_family:
		_publish_prompt_changed()


static func _first_key_name(action: int) -> String:
	var start: int = action * _key_stride
	for j: int in _key_counts[action]:
		if _keys[start + j] > 0:
			return _key_entry_name(_keys[start + j])
	for j: int in _key_counts[action]:
		if _keys[start + j] < 0:
			return _key_entry_name(_keys[start + j])
	return ""


static func _first_pad_name(action: int) -> String:
	var start: int = action * _pad_stride
	for j: int in _pad_counts[action]:
		if _pads[start + j] < _AXIS_BASE:
			return _pad_entry_name(_pads[start + j])
	for j: int in _pad_counts[action]:
		if _pads[start + j] >= _AXIS_BASE:
			return _pad_entry_name(_pads[start + j])
	return ""


## The `input_prompt` row of `family` and `input` in the prompt table; null while `DataCore.is_loaded` is `false`.
static func _find_prompt_row(family: GameData.InputPromptFamily, input: String) -> GameData.InputPromptRow:
	if not DataCore.is_loaded():
		return null
	return _prompt_rows.get(_prompt_key(family, input), null)


static func _build_prompt_rows() -> void:
	_prompt_rows_built = true
	_prompt_rows = {}
	for row: GameData.InputPromptRow in GameData.InputPromptTable.all_rows():
		var key: String = _prompt_key(row.family, row.input)
		if not _prompt_rows.has(key):
			_prompt_rows[key] = row


static func _prompt_key(family: GameData.InputPromptFamily, input: String) -> String:
	return str(family) + ":" + input


static func _add_connected_gamepad(gamepad: int) -> bool:
	if _connected_gamepads.has(gamepad):
		return false
	var at: int = 0
	while at < _connected_gamepads.size() and _connected_gamepads[at] < gamepad:
		at += 1
	_connected_gamepads.insert(at, gamepad)
	return true


# --- bindings


static func _key_entry_name(entry: int) -> String:
	if entry < 0:
		return _MOUSE_BUTTON_NAMES[-entry - 1]
	return OS.get_keycode_string(entry)


static func _pad_entry_name(entry: int) -> String:
	if entry < _AXIS_BASE:
		return _PAD_BUTTON_NAMES[entry]
	var axis: int = (entry - _AXIS_BASE) / 2
	return _PAD_AXIS_NAMES[axis] + ("+" if (entry - _AXIS_BASE) % 2 == 1 else "-")


## Key binding entry of a name: a key code, `-<MouseButton value>`, `_NONE_ENTRY` for the empty string (key none),
## or `_NOT_A_NAME`.
static func _key_entry_of_name(entry_name: String) -> int:
	if entry_name.is_empty():
		return _NONE_ENTRY
	var mouse: int = _MOUSE_BUTTON_NAMES.find(entry_name)
	if mouse >= 0:
		return -(mouse + 1)
	var code: int = OS.find_keycode_from_string(entry_name)
	if code == KEY_NONE or (code & KEY_MODIFIER_MASK) != 0:
		return _NOT_A_NAME
	return code


## Pad binding entry of a name, `_NONE_ENTRY` for the empty string (button none), or `_NOT_A_NAME`.
static func _pad_entry_of_name(entry_name: String) -> int:
	if entry_name.is_empty():
		return _NONE_ENTRY
	var button: int = _PAD_BUTTON_NAMES.find(entry_name)
	if button >= 0:
		return button
	if entry_name.length() < 2:
		return _NOT_A_NAME
	var sign: String = entry_name.right(1)
	var axis: int = _PAD_AXIS_NAMES.find(entry_name.left(entry_name.length() - 1))
	if axis < 0 or (sign != "+" and sign != "-") or (sign == "-" and _is_trigger(axis)):
		return _NOT_A_NAME
	return _axis_entry(axis, sign == "+")


static func _context_of(action: StringName) -> BindingContext:
	var text: String = String(action)
	if action == _BACK or text.begins_with("menu_"):
		return BindingContext.UI
	if text.begins_with("cutscene_"):
		return BindingContext.CUTSCENE
	return BindingContext.GAMEPLAY


static func _binding_entries(action: int, pad: bool) -> PackedInt64Array:
	var stride: int = _pad_stride if pad else _key_stride
	var count: int = _pad_counts[action] if pad else _key_counts[action]
	var source: PackedInt64Array = _pads if pad else _keys
	return source.slice(action * stride, action * stride + count)


static func _default_entries(action: int, pad: bool) -> PackedInt64Array:
	var stride: int = _pad_stride if pad else _key_stride
	var count: int = _default_pad_counts[action] if pad else _default_key_counts[action]
	var source: PackedInt64Array = _default_pads if pad else _default_keys
	return source.slice(action * stride, action * stride + count)


## Puts `entries` as the binding of `action`, releasing its pressed sources first when the binding changes.
static func _put_binding(action: int, pad: bool, entries: PackedInt64Array) -> void:
	if _binding_entries(action, pad) == entries:
		return
	_release_action(action)
	var stride: int = _pad_stride if pad else _key_stride
	for j: int in entries.size():
		if pad:
			_pads[action * stride + j] = entries[j]
		else:
			_keys[action * stride + j] = entries[j]
	if pad:
		_pad_counts[action] = entries.size()
	else:
		_key_counts[action] = entries.size()


## Whether an overlapping action of `action` has an entry of `entries` in its binding (`others`: the binding of each
## action to compare with, or empty for the bindings now).
static func _overlaps(action: int, entries: PackedInt64Array, pad: bool, others: Array[PackedInt64Array]) -> bool:
	for other: int in _action_names.size():
		if other == action or _contexts[other] != _contexts[action]:
			continue
		var bound: PackedInt64Array = others[other] if not others.is_empty() else _binding_entries(other, pad)
		for entry: int in entries:
			if bound.has(entry):
				return true
	return false


## Checks `names` as a binding of `action` and puts its entries in `entries`. `count_first` checks the count before
## the names (`load_keys`); `check_overlap` checks the bindings now of the overlapping actions.
static func _check_binding(action: int, names: PackedStringArray, pad: bool, entries: PackedInt64Array,
		count_first: bool, check_overlap: bool) -> int:
	var limit: int = _max_pad_buttons_per_action if pad else _max_keys_per_action
	if count_first and names.size() > limit:
		return _BIND_TOO_MANY
	entries.resize(names.size())
	for i: int in names.size():
		entries[i] = _pad_entry_of_name(names[i]) if pad else _key_entry_of_name(names[i])
		if entries[i] == _NOT_A_NAME:
			return _BIND_NOT_A_NAME
	if names.is_empty():
		return _BIND_EMPTY
	if entries.has(_NONE_ENTRY):
		return _BIND_NONE
	for i: int in entries.size():
		if entries.find(entries[i]) != i:
			return _BIND_DUPLICATE
	if names.size() > limit:
		return _BIND_TOO_MANY
	var none: Array[PackedInt64Array] = []
	if check_overlap and _overlaps(action, entries, pad, none):
		return _BIND_OVERLAP
	return _BIND_OK


static func _get_binding(operation: String, action: StringName, buffer: PackedStringArray, pad: bool) -> int:
	if not _check_initialized(operation):
		return 0
	if not _action_index.has(action):
		LogCore.log_error(_TAG, operation + ": unknown action " + String(action))
		return 0
	var entries: PackedInt64Array = _binding_entries(_action_index[action], pad)
	var count: int = mini(entries.size(), buffer.size())
	for i: int in count:
		buffer[i] = _pad_entry_name(entries[i]) if pad else _key_entry_name(entries[i])
	if count < entries.size():
		LogCore.log_error(_TAG, operation + ": the buffer is smaller than the binding")
	return count


static func _set_binding(operation: String, action: StringName, names: PackedStringArray, pad: bool) -> bool:
	if not _check_initialized(operation):
		return false
	if not _action_index.has(action):
		LogCore.log_error(_TAG, operation + ": unknown action " + String(action))
		return false
	var index: int = _action_index[action]
	var entries: PackedInt64Array = PackedInt64Array()
	var result: int = _check_binding(index, names, pad, entries, false, true)
	if result == _BIND_NOT_A_NAME:
		LogCore.log_error(_TAG, operation + ": " + _BIND_REASONS[result])
	if result != _BIND_OK:
		return false
	_put_binding(index, pad, entries)
	_save_binding(pad)
	_publish_prompt_changed()
	return true


static func _reset_binding(pad: bool) -> void:
	for action: int in _action_names.size():
		_put_binding(action, pad, _default_entries(action, pad))
	LocalDataCore.remove_value(LocalDataCore.FileKind.DEVICE, _PAD_BINDINGS if pad else _KEY_BINDINGS)
	_publish_prompt_changed()


## Writes the bindings that differ from the default binding: `<action>=<name>,<name>,...` for each action.
static func _save_binding(pad: bool) -> void:
	var items: PackedStringArray = PackedStringArray()
	for action: int in _action_names.size():
		var entries: PackedInt64Array = _binding_entries(action, pad)
		if entries == _default_entries(action, pad):
			continue
		var names: PackedStringArray = PackedStringArray()
		for entry: int in entries:
			names.append(_pad_entry_name(entry) if pad else _key_entry_name(entry))
		items.append(String(_action_names[action]) + "=" + ",".join(names))
	LocalDataCore.set_array_string(LocalDataCore.FileKind.DEVICE, _PAD_BINDINGS if pad else _KEY_BINDINGS, items)


## Applies the saved bindings of one kind. `true` when it applied a saved value.
static func _load_binding(pad: bool) -> bool:
	var operation: String = "load_keys: " + ("gamepad button binding" if pad else "key binding")
	var items: PackedStringArray = \
		LocalDataCore.get_array_string(LocalDataCore.FileKind.DEVICE, _PAD_BINDINGS if pad else _KEY_BINDINGS)
	var count: int = _action_names.size()
	var item_counts: PackedInt32Array = PackedInt32Array()
	item_counts.resize(count)
	var texts: PackedStringArray = PackedStringArray()
	texts.resize(count)
	for item: String in items:
		var separator: int = item.find("=")
		if separator <= 0:
			LogCore.log_warn(_TAG, operation + " has a malformed item")
			continue
		var action: StringName = StringName(item.left(separator))
		if not _action_index.has(action):
			LogCore.log_warn(_TAG, operation + " of " + String(action) + ": not in the action list")
			continue
		var index: int = _action_index[action]
		item_counts[index] += 1
		texts[index] = item.substr(separator + 1)
	var candidates: Array[PackedInt64Array] = []
	candidates.resize(count)
	var active: PackedByteArray = PackedByteArray()
	active.resize(count)
	for action: int in count:
		if item_counts[action] == 0:
			continue
		if item_counts[action] > 1:
			LogCore.log_warn(_TAG, operation + " of " + String(_action_names[action]) + ": saved more than once")
			continue
		var names: PackedStringArray = PackedStringArray() if texts[action].is_empty() else texts[action].split(",")
		var entries: PackedInt64Array = PackedInt64Array()
		var result: int = _check_binding(action, names, pad, entries, true, false)
		if result != _BIND_OK:
			LogCore.log_warn(_TAG, operation + " of " + String(_action_names[action]) + ": " + _BIND_REASONS[result])
			continue
		candidates[action] = entries
		active[action] = 1
	var removed: bool = true
	while removed:
		removed = false
		var bindings: Array[PackedInt64Array] = []
		bindings.resize(count)
		for action: int in count:
			bindings[action] = candidates[action] if active[action] == 1 else _binding_entries(action, pad)
		var drop: PackedByteArray = PackedByteArray()
		drop.resize(count)
		for action: int in count:
			if active[action] == 1 and _overlaps(action, candidates[action], pad, bindings):
				drop[action] = 1
		for action: int in count:
			if drop[action] == 1:
				active[action] = 0
				removed = true
				LogCore.log_warn(_TAG, operation + " of " + String(_action_names[action]) + ": " + _BIND_REASONS[_BIND_OVERLAP])
	var applied: bool = false
	for action: int in count:
		if active[action] == 1:
			_put_binding(action, pad, candidates[action])
			applied = true
	return applied


# --- wait


static func _wait(operation: String, pad: bool) -> String:
	if not _check_initialized(operation):
		return ""
	if (_pad_wait if pad else _key_wait) != null:
		LogCore.log_error(_TAG, operation + ": called while waiting")
		return ""
	var session: RefCounted = _session
	var wait: _WAIT_SCRIPT = _WAIT_SCRIPT.new()
	if pad:
		_pad_wait = wait
	else:
		_key_wait = wait
	await wait.done
	if session != _session:
		return ""
	return wait.value


static func _finish_wait(pad: bool, value: String) -> void:
	var wait: _WAIT_SCRIPT = _pad_wait if pad else _key_wait
	if wait == null:
		return
	if pad:
		_pad_wait = null
	else:
		_key_wait = null
	wait.finish(value)


# --- lifecycle


static func _read_settings() -> bool:
	var ok: bool = true
	for key: String in [_SETTING_MOVE_THRESHOLD, _SETTING_SWIPE_MIN_DISTANCE, _SETTING_PAD_AXIS_WAIT_THRESHOLD,
			_SETTING_PAD_AXIS_DEADZONE]:
		if not CoreSettings.has_float(key):
			LogCore.log_error(_TAG, "init: core settings " + key + " is missing or not a number")
			ok = false
	for key: String in [_SETTING_LONG_PRESS_MS, _SETTING_SWIPE_MAX_MS, _SETTING_MAX_JUDGE_POINTERS,
			_SETTING_MAX_KEYS_PER_ACTION, _SETTING_MAX_PAD_BUTTONS_PER_ACTION]:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init: core settings " + key + " is missing or not an integer")
			ok = false
	if not ok:
		return false
	var threshold: float = CoreSettings.get_float(_SETTING_PAD_AXIS_WAIT_THRESHOLD)
	if not (threshold > 0.0 and threshold <= 1.0):
		LogCore.log_error(_TAG, "init: " + _SETTING_PAD_AXIS_WAIT_THRESHOLD + " is not greater than 0 and at most 1")
		return false
	var deadzone: float = CoreSettings.get_float(_SETTING_PAD_AXIS_DEADZONE)
	if not (deadzone >= 0.0 and deadzone < 1.0):
		LogCore.log_error(_TAG, "init: " + _SETTING_PAD_AXIS_DEADZONE + " is not at least 0 and less than 1")
		return false
	_move_threshold = CoreSettings.get_float(_SETTING_MOVE_THRESHOLD)
	_long_press_ms = CoreSettings.get_int(_SETTING_LONG_PRESS_MS)
	_swipe_max_ms = CoreSettings.get_int(_SETTING_SWIPE_MAX_MS)
	_swipe_min_distance = CoreSettings.get_float(_SETTING_SWIPE_MIN_DISTANCE)
	_max_judge_pointers = maxi(CoreSettings.get_int(_SETTING_MAX_JUDGE_POINTERS), 0)
	_max_keys_per_action = maxi(CoreSettings.get_int(_SETTING_MAX_KEYS_PER_ACTION), 0)
	_max_pad_buttons_per_action = maxi(CoreSettings.get_int(_SETTING_MAX_PAD_BUTTONS_PER_ACTION), 0)
	_pad_axis_wait_threshold = threshold
	_pad_axis_deadzone = deadzone
	return true


## Reads the action list and the default bindings from the input map, and makes the state collections.
static func _read_input_map() -> bool:
	var names: Array[StringName] = []
	for action: StringName in InputMap.get_actions():
		if not String(action).begins_with("ui_"):
			names.append(action)
	names.sort_custom(func(a: StringName, b: StringName) -> bool: return String(a) < String(b))
	for core_action: StringName in _CORE_ACTIONS:
		if not names.has(core_action):
			LogCore.log_error(_TAG, "init: the input map has no core action " + String(core_action))
			return false
	var key_lists: Array[PackedInt64Array] = []
	var pad_lists: Array[PackedInt64Array] = []
	for action: StringName in names:
		var keys: PackedInt64Array = PackedInt64Array()
		var pads: PackedInt64Array = PackedInt64Array()
		for event: InputEvent in InputMap.action_get_events(action):
			var key_entry: int = KEY_NONE
			var pad_entry: int = -1
			if event is InputEventKey:
				key_entry = _key_code_of(event as InputEventKey)
			elif event is InputEventMouseButton:
				var button: int = (event as InputEventMouseButton).button_index
				if button >= 1 and button <= _MOUSE_BUTTON_NAMES.size():
					key_entry = -button
			elif event is InputEventJoypadButton:
				var pad_button: int = (event as InputEventJoypadButton).button_index
				if pad_button >= 0 and pad_button < _PAD_BUTTON_NAMES.size():
					pad_entry = pad_button
			elif event is InputEventJoypadMotion:
				var motion: InputEventJoypadMotion = event as InputEventJoypadMotion
				if motion.axis >= 0 and motion.axis < _PAD_AXIS_NAMES.size() and motion.axis_value != 0.0 \
						and not (motion.axis_value < 0.0 and _is_trigger(motion.axis)):
					pad_entry = _axis_entry(motion.axis, motion.axis_value > 0.0)
			if key_entry != KEY_NONE and not keys.has(key_entry):
				keys.append(key_entry)
			if pad_entry >= 0 and not pads.has(pad_entry):
				pads.append(pad_entry)
		key_lists.append(keys)
		pad_lists.append(pads)
	var count: int = names.size()
	_action_names = names
	_action_index = {}
	_contexts = PackedInt32Array()
	_contexts.resize(count)
	_key_stride = _max_keys_per_action
	_pad_stride = _max_pad_buttons_per_action
	for i: int in count:
		_action_index[names[i]] = i
		_contexts[i] = _context_of(names[i])
		_key_stride = maxi(_key_stride, key_lists[i].size())
		_pad_stride = maxi(_pad_stride, pad_lists[i].size())
	_back_index = _action_index[_BACK]
	for i: int in count:
		for j: int in range(i + 1, count):
			if _contexts[i] != _contexts[j]:
				continue
			for entry: int in key_lists[i]:
				if key_lists[j].has(entry):
					return _default_overlap(names[i], names[j])
			for entry: int in pad_lists[i]:
				if pad_lists[j].has(entry):
					return _default_overlap(names[i], names[j])
	_keys = PackedInt64Array()
	_keys.resize(count * _key_stride)
	_key_counts = PackedInt32Array()
	_key_counts.resize(count)
	_pads = PackedInt64Array()
	_pads.resize(count * _pad_stride)
	_pad_counts = PackedInt32Array()
	_pad_counts.resize(count)
	for i: int in count:
		for j: int in key_lists[i].size():
			_keys[i * _key_stride + j] = key_lists[i][j]
		for j: int in pad_lists[i].size():
			_pads[i * _pad_stride + j] = pad_lists[i][j]
		_key_counts[i] = key_lists[i].size()
		_pad_counts[i] = pad_lists[i].size()
	_default_keys = _keys.duplicate()
	_default_key_counts = _key_counts.duplicate()
	_default_pads = _pads.duplicate()
	_default_pad_counts = _pad_counts.duplicate()
	_source_stride = _key_stride + _pad_stride * _GAMEPAD_SLOTS + 1
	_source_pressed = PackedByteArray()
	_source_pressed.resize(count * _source_stride)
	_source_strength = PackedFloat32Array()
	_source_strength.resize(count * _source_stride)
	_pressed_counts = PackedInt32Array()
	_pressed_counts.resize(count)
	_pressed_frames = PackedInt64Array()
	_pressed_frames.resize(count)
	_pressed_frames.fill(-1)
	_released_frames = PackedInt64Array()
	_released_frames.resize(count)
	_released_frames.fill(-1)
	_frames_pending = false
	var slots: int = _max_judge_pointers + _EXTRA_POINTER_SLOTS
	_pointer_used = PackedByteArray()
	_pointer_used.resize(slots)
	_pointer_ids = PackedInt64Array()
	_pointer_ids.resize(slots)
	_pointer_ids.fill(-1)
	_pointer_passed = PackedByteArray()
	_pointer_passed.resize(slots)
	_pointer_judge = PackedByteArray()
	_pointer_judge.resize(slots)
	_pointer_moved = PackedByteArray()
	_pointer_moved.resize(slots)
	_pointer_long_pressed = PackedByteArray()
	_pointer_long_pressed.resize(slots)
	_pointer_dragging = PackedByteArray()
	_pointer_dragging.resize(slots)
	_pointer_press_positions = PackedVector2Array()
	_pointer_press_positions.resize(slots)
	_pointer_positions = PackedVector2Array()
	_pointer_positions.resize(slots)
	_pointer_drag_positions = PackedVector2Array()
	_pointer_drag_positions.resize(slots)
	_pointer_press_times = PackedInt64Array()
	_pointer_press_times.resize(slots)
	_pointer_orders = PackedInt64Array()
	_pointer_orders.resize(slots)
	_gamepad_slot_ids = PackedInt32Array()
	_gamepad_slot_ids.resize(_GAMEPAD_SLOTS)
	_gamepad_slot_ids.fill(-1)
	_axis_values = PackedFloat32Array()
	_axis_values.resize(_GAMEPAD_SLOTS * JOY_AXIS_MAX)
	_passed = PackedByteArray()
	_passed.resize(count)
	return true


static func _default_overlap(first: StringName, second: StringName) -> bool:
	LogCore.log_error(_TAG, "init: overlapping actions " + String(first) + " and " + String(second) + " share a default binding input")
	return false


## Undoes `init`. `remove_node` is false when the core node leaves the tree outside `release` (app exit).
static func _cleanup(remove_node: bool) -> void:
	var node: Node = _node
	_node = null
	_session = null
	if node != null and is_instance_valid(node):
		var receiver: _NODE_SCRIPT = node as _NODE_SCRIPT
		if receiver != null and Input.joy_connection_changed.is_connected(receiver._on_joy_connection_changed):
			Input.joy_connection_changed.disconnect(receiver._on_joy_connection_changed)
		var frame_tree: SceneTree = Engine.get_main_loop() as SceneTree
		if receiver != null and frame_tree != null:
			if frame_tree.physics_frame.is_connected(receiver._on_tree_frame):
				frame_tree.physics_frame.disconnect(receiver._on_tree_frame)
			if frame_tree.process_frame.is_connected(receiver._on_tree_frame):
				frame_tree.process_frame.disconnect(receiver._on_tree_frame)
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		var tree: SceneTree = node.get_tree()
		if tree != null and _is_initialized:
			tree.quit_on_go_back = _quit_on_go_back
		if remove_node:
			if node.get_parent() != null:
				node.get_parent().remove_child(node)
			node.queue_free()
	_finish_wait(false, "")
	_finish_wait(true, "")
	_reset_state()


## Puts every static var back to its initial value.
static func _reset_state() -> void:
	_is_initialized = false
	_node = null
	_session = null
	_quit_on_go_back = true
	_move_threshold = 0.0
	_long_press_ms = 0
	_swipe_max_ms = 0
	_swipe_min_distance = 0.0
	_max_judge_pointers = 0
	_max_keys_per_action = 0
	_max_pad_buttons_per_action = 0
	_pad_axis_wait_threshold = 0.0
	_pad_axis_deadzone = 0.0
	_action_names = []
	_action_index = {}
	_contexts = PackedInt32Array()
	_back_index = -1
	_key_stride = 0
	_pad_stride = 0
	_keys = PackedInt64Array()
	_key_counts = PackedInt32Array()
	_pads = PackedInt64Array()
	_pad_counts = PackedInt32Array()
	_default_keys = PackedInt64Array()
	_default_key_counts = PackedInt32Array()
	_default_pads = PackedInt64Array()
	_default_pad_counts = PackedInt32Array()
	_source_stride = 0
	_source_pressed = PackedByteArray()
	_source_strength = PackedFloat32Array()
	_pressed_counts = PackedInt32Array()
	_pressed_frames = PackedInt64Array()
	_released_frames = PackedInt64Array()
	_frames_pending = false
	_pointer_used = PackedByteArray()
	_pointer_ids = PackedInt64Array()
	_pointer_passed = PackedByteArray()
	_pointer_judge = PackedByteArray()
	_pointer_moved = PackedByteArray()
	_pointer_long_pressed = PackedByteArray()
	_pointer_dragging = PackedByteArray()
	_pointer_press_positions = PackedVector2Array()
	_pointer_positions = PackedVector2Array()
	_pointer_drag_positions = PackedVector2Array()
	_pointer_press_times = PackedInt64Array()
	_pointer_orders = PackedInt64Array()
	_press_order = 0
	_releasing_slot = -1
	_emulated_pressed = false
	_emulated_passed = false
	_pinch_enabled = false
	_pinch_first = -1
	_pinch_second = -1
	_pinch_start_distance = 0.0
	_pinch_center = Vector2.ZERO
	_pinch_scale = 1.0
	_device = InputDevice.KEYBOARD_MOUSE
	_gamepad_family = GameData.InputPromptFamily.GENERIC
	_gamepad_families = {}
	_last_gamepad = -1
	_connected_gamepads = PackedInt32Array()
	_gamepad_slot_ids = PackedInt32Array()
	_axis_values = PackedFloat32Array()
	_has_mouse_position = false
	_mouse_position = Vector2.ZERO
	_mouse_motion = Vector2.ZERO
	_mouse_motion_frame = -1
	_last_blocked = false
	_cancel_count = 0
	_back_handler = Callable()
	_pointer_observer = Callable()
	_key_wait = null
	_pad_wait = null
	_prompt_rows = {}
	_prompt_rows_built = false
	_pending_event = null
	_pending_focus = false
	_pending_kind = _OTHER
	_pending_slot = -1
	_pending_position = Vector2.ZERO
	_pending_axis_previous = 0.0
	_pending_pad_slot = -1
	_passed = PackedByteArray()
	_debug_handler = Callable()


static func _check_initialized(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, operation + ": not initialized")
	return false


static func _is_finite(position: Vector2) -> bool:
	return is_finite(position.x) and is_finite(position.y)


## Whether a callback result is the bool `true`.
# ogw:input_boundary
static func _is_true(result: Variant) -> bool:
	if result is bool:
		var value: bool = result
		return value
	return false
