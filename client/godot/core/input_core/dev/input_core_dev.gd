class_name InputCoreDev
extends RefCounted
## DEV operations of `InputCore`.

const _TAG: String = "InputCore"


## Registers `callback`(device input → whether it handled the input), called for every device input at the debug
## stage, also in the blocked state. An empty `Callable()` clears it.
static func set_debug_input_handler(callback: Callable) -> void:
	if not _check_initialized("set_debug_input_handler"):
		return
	if not callback.is_null() and not callback.is_valid():
		LogCore.log_error(_TAG, "set_debug_input_handler: the callback cannot be called")
		return
	InputCore._debug_handler = callback


## Puts one device input in front of engine input processing, like a real device input. Positions are game
## coordinates. A gamepad button or gamepad axis input is an input of gamepad ID `gamepad_id`. The relative motion of a
## mouse motion is the difference from the mouse position before it, (0, 0) when there is no mouse position.
static func inject_device_input(event: InputEvent, gamepad_id: int = 0) -> void:
	if not _check_initialized("inject_device_input"):
		return
	if event == null:
		LogCore.log_error(_TAG, "inject_device_input: the input is null")
		return
	var input: InputEvent = event.duplicate() as InputEvent
	if input is InputEventJoypadButton or input is InputEventJoypadMotion:
		if gamepad_id < 0:
			LogCore.log_error(_TAG, "inject_device_input: the gamepad ID is negative")
			return
		input.device = gamepad_id
	# the engine reads input positions as real window pixels
	var scale: Vector2 = InputCore._real_to_window_scale()
	if input is InputEventMouseMotion:
		var motion: InputEventMouseMotion = input as InputEventMouseMotion
		var relative: Vector2 = motion.position - InputCore._mouse_position if InputCore._has_mouse_position \
			else Vector2.ZERO
		motion.relative = ResolutionCore.game_to_window(relative) / scale
	if input is InputEventMouse:
		var mouse: InputEventMouse = input as InputEventMouse
		mouse.position = ResolutionCore.game_to_window(mouse.position) / scale
		mouse.global_position = mouse.position
	elif input is InputEventScreenTouch:
		var touch: InputEventScreenTouch = input as InputEventScreenTouch
		touch.position = ResolutionCore.game_to_window(touch.position) / scale
	elif input is InputEventScreenDrag:
		var drag: InputEventScreenDrag = input as InputEventScreenDrag
		drag.position = ResolutionCore.game_to_window(drag.position) / scale
		drag.relative = ResolutionCore.game_to_window(drag.relative) / scale
	Input.parse_input_event(input)
	Input.flush_buffered_events()
	# The viewport input dispatch of the input has returned, so a pointer release it carried has been processed.
	if InputCore._is_initialized:
		InputCore._end_release()


## Handles an app focus loss without an engine notification.
static func inject_focus_lost() -> void:
	if not _check_initialized("inject_focus_lost"):
		return
	InputCore._on_focus_lost()


## Sets the input device. Device detection goes on as before afterwards.
static func set_test_device(device: InputCore.InputDevice) -> void:
	if not _check_initialized("set_test_device"):
		return
	if device != InputCore.InputDevice.TOUCH and device != InputCore.InputDevice.KEYBOARD_MOUSE \
			and device != InputCore.InputDevice.GAMEPAD:
		LogCore.log_error(_TAG, "set_test_device: not an InputDevice")
		return
	InputCore._set_device(device)


## Sets the gamepad family to `Generic`, `Xbox`, `PlayStation` or `Nintendo`. A gamepad input decides it again
## afterwards.
static func set_test_gamepad_family(family: GameData.InputPromptFamily) -> void:
	if not _check_initialized("set_test_gamepad_family"):
		return
	if family != GameData.InputPromptFamily.GENERIC and family != GameData.InputPromptFamily.XBOX \
			and family != GameData.InputPromptFamily.PLAY_STATION and family != GameData.InputPromptFamily.NINTENDO:
		LogCore.log_error(_TAG, "set_test_gamepad_family: not a gamepad family")
		return
	InputCore._set_gamepad_family(family)


## Handles a gamepad connection or disconnection without an engine notification.
static func inject_gamepad_connection(gamepad_id: int, connected: bool) -> void:
	if not _check_initialized("inject_gamepad_connection"):
		return
	InputCore._on_gamepad_connection(gamepad_id, connected)


static func _check_initialized(operation: String) -> bool:
	if InputCore.is_initialized():
		return true
	LogCore.log_error(_TAG, operation + ": not initialized")
	return false
