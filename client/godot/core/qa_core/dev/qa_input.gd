extends RefCounted
## Device inputs of the `QACore` input commands: the names they take, the inputs they hold pressed, the input events
## they put in through `InputCoreDev.inject_device_input`, and the debug screen toggle input. Positions are game
## coordinates. The held inputs follow the inputs put in (`apply`), not the inputs waiting for the next frame start.

## What a device input does to the debug screen.
enum DebugInput { NONE, TOGGLE, CONSUME }

const PAD_BUTTON_NAMES: PackedStringArray = [
	"a", "b", "x", "y", "back", "guide", "start", "left_stick", "right_stick", "left_shoulder", "right_shoulder",
	"dpad_up", "dpad_down", "dpad_left", "dpad_right",
]
const _PAD_BUTTONS: PackedInt32Array = [
	JOY_BUTTON_A, JOY_BUTTON_B, JOY_BUTTON_X, JOY_BUTTON_Y, JOY_BUTTON_BACK, JOY_BUTTON_GUIDE, JOY_BUTTON_START,
	JOY_BUTTON_LEFT_STICK, JOY_BUTTON_RIGHT_STICK, JOY_BUTTON_LEFT_SHOULDER, JOY_BUTTON_RIGHT_SHOULDER,
	JOY_BUTTON_DPAD_UP, JOY_BUTTON_DPAD_DOWN, JOY_BUTTON_DPAD_LEFT, JOY_BUTTON_DPAD_RIGHT,
]
const PAD_AXIS_NAMES: PackedStringArray = ["left_x", "left_y", "right_x", "right_y", "trigger_left", "trigger_right"]
const _PAD_AXES: PackedInt32Array = [
	JOY_AXIS_LEFT_X, JOY_AXIS_LEFT_Y, JOY_AXIS_RIGHT_X, JOY_AXIS_RIGHT_Y, JOY_AXIS_TRIGGER_LEFT, JOY_AXIS_TRIGGER_RIGHT,
]
## Lowest value of each gamepad axis, in `PAD_AXIS_NAMES` order. The highest is 1.
const _PAD_AXIS_MIN: PackedFloat64Array = [-1.0, -1.0, -1.0, -1.0, 0.0, 0.0]
const MOUSE_BUTTON_NAMES: PackedStringArray = ["left", "right", "middle"]
const _MOUSE_BUTTONS: PackedInt32Array = [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE]
## Touches pressed at once that open and close the debug screen.
const _DEBUG_TOUCHES: int = 4
const _DEBUG_KEY: Key = KEY_F12

## Touch index → position of the touches the input commands hold pressed.
var touches: Dictionary[int, Vector2] = {}
var keys: Dictionary[int, bool] = {}
var mouse_buttons: Dictionary[int, bool] = {}
var pad_buttons: Dictionary[int, bool] = {}
## Gamepad axis → the value an input command put in, for the axes not at 0.
var axes: Dictionary[int, float] = {}
var mouse_position: Vector2 = Vector2.ZERO
## Touch indexes pressed on the device, for the debug screen toggle.
var _device_touches: Dictionary[int, bool] = {}


## Keycode of key name `key_name` (`OS.get_keycode_string`); `KEY_NONE` when it is not a key name: the engine finds
## no key, or a key with modifier bits.
static func key_code(key_name: String) -> Key:
	if key_name.is_empty():
		return KEY_NONE
	var code: int = OS.find_keycode_from_string(key_name)
	if (code & KEY_MODIFIER_MASK) != 0:
		return KEY_NONE
	return code as Key


## `JoyButton` of a gamepad button name; -1 when it is not one.
static func pad_button(button_name: String) -> int:
	var index: int = PAD_BUTTON_NAMES.find(button_name)
	return _PAD_BUTTONS[index] if index >= 0 else -1


## `JoyAxis` of a gamepad axis name; -1 when it is not one.
static func pad_axis(axis_name: String) -> int:
	var index: int = PAD_AXIS_NAMES.find(axis_name)
	return _PAD_AXES[index] if index >= 0 else -1


static func is_in_axis_range(axis_name: String, value: float) -> bool:
	var index: int = PAD_AXIS_NAMES.find(axis_name)
	return index >= 0 and value >= _PAD_AXIS_MIN[index] and value <= 1.0


## `MouseButton` of a mouse button name; -1 when it is not one.
static func mouse_button(button_name: String) -> int:
	var index: int = MOUSE_BUTTON_NAMES.find(button_name)
	return _MOUSE_BUTTONS[index] if index >= 0 else -1


## Smallest touch index below `limit` that is not held pressed; -1 when there is none.
func free_touch_index(limit: int) -> int:
	for index: int in limit:
		if not touches.has(index):
			return index
	return -1


static func touch_event(index: int, position: Vector2, pressed: bool) -> InputEventScreenTouch:
	var event: InputEventScreenTouch = InputEventScreenTouch.new()
	event.index = index
	event.position = position
	event.pressed = pressed
	return event


static func drag_event(index: int, position: Vector2, relative: Vector2) -> InputEventScreenDrag:
	var event: InputEventScreenDrag = InputEventScreenDrag.new()
	event.index = index
	event.position = position
	event.relative = relative
	return event


static func key_event(code: Key, pressed: bool) -> InputEventKey:
	var event: InputEventKey = InputEventKey.new()
	event.keycode = code
	event.physical_keycode = code
	event.pressed = pressed
	return event


## One text input: a key press that types `character`.
static func text_event(character: String) -> InputEventKey:
	var event: InputEventKey = InputEventKey.new()
	event.unicode = character.unicode_at(0)
	event.pressed = true
	return event


## A press or release of `button`: its button mask is the held buttons with `button` pressed or released.
func mouse_button_event(button: int, position: Vector2, pressed: bool) -> InputEventMouseButton:
	var event: InputEventMouseButton = InputEventMouseButton.new()
	event.button_index = button as MouseButton
	event.pressed = pressed
	event.position = position
	event.global_position = position
	var bit: int = 1 << (button - 1)
	event.button_mask = (_button_mask() | bit if pressed else _button_mask() & ~bit) as MouseButtonMask
	return event


func mouse_motion_event(position: Vector2) -> InputEventMouseMotion:
	var event: InputEventMouseMotion = InputEventMouseMotion.new()
	event.position = position
	event.global_position = position
	event.button_mask = _button_mask()
	return event


static func pad_button_event(button: int, pressed: bool) -> InputEventJoypadButton:
	var event: InputEventJoypadButton = InputEventJoypadButton.new()
	event.button_index = button as JoyButton
	event.pressed = pressed
	event.pressure = 1.0 if pressed else 0.0
	return event


static func pad_axis_event(axis: int, value: float) -> InputEventJoypadMotion:
	var event: InputEventJoypadMotion = InputEventJoypadMotion.new()
	event.axis = axis as JoyAxis
	event.axis_value = value
	return event


## The releases of every held touch, key, mouse button and gamepad button and 0 for every gamepad axis not at 0. Forgets
## them, so the held inputs are empty before the releases are put in.
func release_events() -> Array[InputEvent]:
	var events: Array[InputEvent] = []
	for index: int in touches:
		events.append(touch_event(index, touches[index], false))
	for code: int in keys:
		events.append(key_event(code as Key, false))
	var held_buttons: Array[int] = mouse_buttons.keys()
	for button: int in held_buttons:
		events.append(mouse_button_event(button, mouse_position, false))
		mouse_buttons.erase(button)
	for button: int in pad_buttons:
		events.append(pad_button_event(button, false))
	for axis: int in axes:
		events.append(pad_axis_event(axis, 0.0))
	forget()
	return events


## Takes in `event`, a device input that was put in: the held inputs it presses, moves and releases.
func apply(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var touch: InputEventScreenTouch = event as InputEventScreenTouch
		if touch.pressed:
			touches[touch.index] = touch.position
		else:
			touches.erase(touch.index)
	elif event is InputEventScreenDrag:
		var drag: InputEventScreenDrag = event as InputEventScreenDrag
		touches[drag.index] = drag.position
	elif event is InputEventKey:
		var key: InputEventKey = event as InputEventKey
		if key.keycode == KEY_NONE:
			return
		if key.pressed:
			keys[key.keycode] = true
		else:
			keys.erase(key.keycode)
	elif event is InputEventMouseMotion:
		mouse_position = (event as InputEventMouseMotion).position
	elif event is InputEventMouseButton:
		var mouse: InputEventMouseButton = event as InputEventMouseButton
		mouse_position = mouse.position
		if mouse.pressed:
			mouse_buttons[mouse.button_index] = true
		else:
			mouse_buttons.erase(mouse.button_index)
	elif event is InputEventJoypadButton:
		var pad: InputEventJoypadButton = event as InputEventJoypadButton
		if pad.pressed:
			pad_buttons[pad.button_index] = true
		else:
			pad_buttons.erase(pad.button_index)
	elif event is InputEventJoypadMotion:
		var motion: InputEventJoypadMotion = event as InputEventJoypadMotion
		if motion.axis_value == 0.0:
			axes.erase(motion.axis)
		else:
			axes[motion.axis] = motion.axis_value


func forget() -> void:
	touches.clear()
	keys.clear()
	mouse_buttons.clear()
	pad_buttons.clear()
	axes.clear()


## `TOGGLE` for the `F12` press and the fourth touch pressed at once, `CONSUME` for the `F12` release.
func debug_input(event: InputEvent) -> DebugInput:
	if event is InputEventKey:
		var key: InputEventKey = event as InputEventKey
		var code: Key = key.keycode if key.keycode != KEY_NONE else key.physical_keycode
		if code != _DEBUG_KEY:
			return DebugInput.NONE
		if key.pressed and not key.echo:
			return DebugInput.TOGGLE
		return DebugInput.CONSUME
	if event is InputEventScreenTouch:
		var touch: InputEventScreenTouch = event as InputEventScreenTouch
		if not touch.pressed:
			_device_touches.erase(touch.index)
			return DebugInput.NONE
		_device_touches[touch.index] = true
		if _device_touches.size() == _DEBUG_TOUCHES:
			return DebugInput.TOGGLE
	return DebugInput.NONE


func _button_mask() -> MouseButtonMask:
	var mask: int = 0
	for button: int in mouse_buttons:
		mask |= 1 << (button - 1)
	return mask as MouseButtonMask
