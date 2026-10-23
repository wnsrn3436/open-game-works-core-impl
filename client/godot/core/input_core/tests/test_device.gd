extends InputCoreTestCase
## Input device, last gamepad, connected gamepads, gamepad family and prompt family.


func before_each() -> void:
	super()
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	recorder.clear()


func test_device_changed_event_once_per_device_change() -> void:
	touch(0, true, CENTER)
	touch(0, false, CENTER)
	assert_eq(recorder.count("device"), 1, "touch, and not the mouse input the engine made from it")
	assert_eq(InputCore.get_device(), InputCore.InputDevice.TOUCH)
	touch(1, true, CENTER)
	touch(1, false, CENTER)
	assert_eq(recorder.count("device"), 1)
	press_key(KEY_J)
	assert_eq(recorder.count("device"), 2)
	assert_eq(InputCore.get_device(), InputCore.InputDevice.KEYBOARD_MOUSE)
	InputCore.inject_action(&"fire", true, 1.0)
	pad_axis(JOY_AXIS_RIGHT_X, 0.9)
	assert_eq(recorder.count("device"), 2, "no change for an inject and an axis input that presses no action")
	pad_axis(JOY_AXIS_LEFT_X, 0.5)
	assert_eq(recorder.count("device"), 3)
	assert_eq(InputCore.get_device(), InputCore.InputDevice.GAMEPAD)
	assert_eq(recorder.of("device")[2].device, InputCore.InputDevice.GAMEPAD)


func test_axis_direction_below_the_deadzone_does_not_change_the_device() -> void:
	pad_axis(JOY_AXIS_LEFT_X, PAD_AXIS_DEADZONE - 0.05)
	assert_eq(recorder.count("device"), 0)
	assert_eq(InputCore.get_device(), InputCore.InputDevice.KEYBOARD_MOUSE)
	pad_axis(JOY_AXIS_LEFT_X, PAD_AXIS_DEADZONE + 0.1)
	assert_eq(recorder.count("device"), 1)
	assert_eq(InputCore.get_device(), InputCore.InputDevice.GAMEPAD)
	pad_axis(JOY_AXIS_LEFT_X, 0.0)


func test_injected_gamepad_input_matches_engine_gamepad_input() -> void:
	Input.parse_input_event(pad_button_event(JOY_BUTTON_A, true))
	Input.flush_buffered_events()
	await input_frame()
	var engine_state: Array[bool] = [InputCore.is_pressed(&"cutscene_advance"), InputCore.is_just_pressed(&"cutscene_advance")]
	var engine_devices: int = recorder.count("device")
	Input.parse_input_event(pad_button_event(JOY_BUTTON_A, false))
	var axis: InputEventJoypadMotion = pad_axis_event(JOY_AXIS_LEFT_X, 0.7)
	Input.parse_input_event(axis)
	Input.flush_buffered_events()
	var engine_strength: float = InputCore.get_strength(&"move_right")
	Input.parse_input_event(pad_axis_event(JOY_AXIS_LEFT_X, 0.0))
	Input.flush_buffered_events()
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	recorder.clear()
	await next_frame()
	pad_button(JOY_BUTTON_A, true)
	await input_frame()
	assert_eq([InputCore.is_pressed(&"cutscene_advance"), InputCore.is_just_pressed(&"cutscene_advance")], engine_state)
	assert_eq(recorder.count("device"), engine_devices)
	pad_button(JOY_BUTTON_A, false)
	pad_axis(JOY_AXIS_LEFT_X, 0.7)
	assert_almost_eq(InputCore.get_strength(&"move_right"), engine_strength, 0.0001)
	assert_eq(engine_state, [true, true])
	assert_eq(engine_devices, 1)


func test_last_gamepad() -> void:
	assert_eq(InputCore.get_last_gamepad(), -1)
	pad_button(JOY_BUTTON_A, true)
	assert_eq(InputCore.get_last_gamepad(), 0)
	var other: InputEventJoypadMotion = pad_axis_event(JOY_AXIS_RIGHT_X, 0.9)
	other.device = 3
	Input.parse_input_event(other)
	Input.flush_buffered_events()
	assert_eq(InputCore.get_last_gamepad(), 0, "an axis input that presses no action does not change it")
	var pressing: InputEventJoypadMotion = pad_axis_event(JOY_AXIS_LEFT_X, 0.9)
	pressing.device = 3
	Input.parse_input_event(pressing)
	Input.flush_buffered_events()
	assert_eq(InputCore.get_last_gamepad(), 3)
	assert_true(restart_input_core())
	assert_eq(InputCore.get_last_gamepad(), -1)


func test_connected_gamepads() -> void:
	var buffer: PackedInt32Array = PackedInt32Array([-1, -1, -1])
	InputCoreDev.inject_gamepad_connection(1, true)
	assert_eq(InputCore.get_connected_gamepads(buffer), 1)
	assert_eq(buffer[0], 1)
	assert_eq(recorder.count("gamepad"), 1)
	assert_eq([recorder.of("gamepad")[0].gamepad_id, recorder.of("gamepad")[0].connected], [1, true])
	InputCoreDev.inject_gamepad_connection(1, true)
	assert_eq(recorder.count("gamepad"), 1, "no event when the list does not change")
	InputCoreDev.inject_gamepad_connection(4, true)
	InputCoreDev.inject_gamepad_connection(2, true)
	assert_eq(InputCore.get_connected_gamepads(buffer), 3)
	assert_eq(buffer, PackedInt32Array([1, 2, 4]), "ascending")
	InputCoreDev.inject_gamepad_connection(1, false)
	assert_eq(InputCore.get_connected_gamepads(buffer), 2)
	assert_eq(buffer[0], 2)
	assert_eq(recorder.count("gamepad"), 4)
	var last: InputCoreTestRecord = recorder.of("gamepad")[3]
	assert_eq([last.gamepad_id, last.connected], [1, false])
	var small: PackedInt32Array = PackedInt32Array([0])
	assert_eq(InputCore.get_connected_gamepads(small), 1)
	assert_eq(errors(), 1, "the buffer is too small")


func test_disconnecting_a_gamepad_releases_its_sources() -> void:
	InputCoreDev.inject_gamepad_connection(0, true)
	pad_button(JOY_BUTTON_A, true)
	pad_axis(JOY_AXIS_LEFT_X, 0.8)
	key(KEY_J, true)
	assert_true(InputCore.is_pressed(&"cutscene_advance"))
	InputCoreDev.inject_gamepad_connection(0, false)
	assert_false(InputCore.is_pressed(&"cutscene_advance"))
	assert_false(InputCore.is_pressed(&"move_right"))
	assert_true(InputCore.is_pressed(&"jump"), "a key source stays pressed")
	assert_eq(InputCore.get_last_gamepad(), -1)
	assert_eq(InputCore.get_device(), InputCore.InputDevice.KEYBOARD_MOUSE)
	pad_button(JOY_BUTTON_A, true)
	InputCoreDev.inject_gamepad_connection(0, false)
	assert_eq(InputCore.get_device(), InputCore.InputDevice.GAMEPAD, "the input device does not change")


func test_set_test_device() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_eq(recorder.count("device"), 1)
	assert_eq(InputCore.get_device(), InputCore.InputDevice.GAMEPAD)
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_eq(recorder.count("device"), 1)
	touch(0, true, CENTER)
	assert_eq(InputCore.get_device(), InputCore.InputDevice.TOUCH)


func test_prompt_family_follows_the_device() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_eq(InputCore.get_prompt_family(), GameData.InputPromptFamily.TOUCH)
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_eq(InputCore.get_prompt_family(), GameData.InputPromptFamily.KEYBOARD_MOUSE)
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_eq(InputCore.get_prompt_family(), GameData.InputPromptFamily.GENERIC, "the gamepad family after init")


func test_set_test_gamepad_family() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	recorder.clear()
	InputCoreDev.set_test_gamepad_family(GameData.InputPromptFamily.PLAY_STATION)
	assert_eq(recorder.count("prompt"), 1)
	assert_eq(recorder.of("prompt")[0].family, GameData.InputPromptFamily.PLAY_STATION)
	assert_eq(InputCore.get_prompt_family(), GameData.InputPromptFamily.PLAY_STATION)
	InputCoreDev.set_test_gamepad_family(GameData.InputPromptFamily.PLAY_STATION)
	assert_eq(recorder.count("prompt"), 1)
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	recorder.clear()
	InputCoreDev.set_test_gamepad_family(GameData.InputPromptFamily.XBOX)
	assert_eq(recorder.count("prompt"), 0, "the prompt family does not change")
	InputCoreDev.set_test_gamepad_family(GameData.InputPromptFamily.TOUCH)
	assert_eq(errors(), 1)
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_eq(InputCore.get_prompt_family(), GameData.InputPromptFamily.XBOX)
	pad_button(JOY_BUTTON_A, true)
	assert_eq(InputCore.get_prompt_family(), GameData.InputPromptFamily.GENERIC,
		"a gamepad input decides the family from its name again")


func test_device_change_comes_before_its_prompt_change() -> void:
	touch(0, true, CENTER)
	assert_eq(recorder.kinds(), PackedStringArray(["device", "prompt"]))
	assert_eq(recorder.of("prompt")[0].family, GameData.InputPromptFamily.TOUCH)
	recorder.clear()
	pad_button(JOY_BUTTON_A, true)
	assert_eq(recorder.kinds(), PackedStringArray(["device", "prompt"]))
	assert_eq(recorder.of("prompt")[0].family, GameData.InputPromptFamily.GENERIC)


func test_gamepad_family_of_a_gamepad_name() -> void:
	var cases: Dictionary[String, GameData.InputPromptFamily] = {
		"Xbox Wireless Controller": GameData.InputPromptFamily.XBOX,
		"XInput Controller": GameData.InputPromptFamily.XBOX,
		"XBOX 360 CONTROLLER": GameData.InputPromptFamily.XBOX,
		"Sony PlayStation Controller": GameData.InputPromptFamily.PLAY_STATION,
		"PS3 Controller": GameData.InputPromptFamily.PLAY_STATION,
		"PS4 Controller": GameData.InputPromptFamily.PLAY_STATION,
		"ps5 controller": GameData.InputPromptFamily.PLAY_STATION,
		"DualShock 4": GameData.InputPromptFamily.PLAY_STATION,
		"DualSense Wireless Controller": GameData.InputPromptFamily.PLAY_STATION,
		"Nintendo Pro Controller": GameData.InputPromptFamily.NINTENDO,
		"Switch Controller": GameData.InputPromptFamily.NINTENDO,
		"Joy-Con (L)": GameData.InputPromptFamily.NINTENDO,
		"PS4 Controller (XInput)": GameData.InputPromptFamily.XBOX,
		"Nintendo Switch PlayStation Adapter": GameData.InputPromptFamily.PLAY_STATION,
		"Logitech Gamepad F310": GameData.InputPromptFamily.GENERIC,
		"": GameData.InputPromptFamily.GENERIC,
	}
	for joy_name: String in cases:
		assert_eq(InputCore._family_of_name(joy_name), cases[joy_name], joy_name)


func test_gamepad_family_comes_from_the_gamepad_connected_at_the_id() -> void:
	InputCore._change_gamepad_connection(0, true, "Xbox Wireless Controller")
	pad_button(JOY_BUTTON_A, true)
	pad_button(JOY_BUTTON_A, false)
	assert_eq(InputCore.get_prompt_family(), GameData.InputPromptFamily.XBOX)
	InputCore._change_gamepad_connection(0, false, "")
	pad_button(JOY_BUTTON_A, true)
	pad_button(JOY_BUTTON_A, false)
	assert_eq(InputCore.get_prompt_family(), GameData.InputPromptFamily.GENERIC,
		"a disconnected gamepad's family is forgotten")
	InputCore._change_gamepad_connection(0, true, "DualSense Wireless Controller")
	recorder.clear()
	pad_button(JOY_BUTTON_A, true)
	assert_eq(InputCore.get_prompt_family(), GameData.InputPromptFamily.PLAY_STATION,
		"another gamepad connected at the same ID decides the family")
	assert_eq(recorder.kinds(), PackedStringArray(["prompt"]))
	assert_eq(recorder.of("prompt")[0].family, GameData.InputPromptFamily.PLAY_STATION)
	pad_button(JOY_BUTTON_A, false)


func test_disconnecting_a_gamepad_keeps_the_device_and_the_gamepad_family() -> void:
	InputCoreDev.inject_gamepad_connection(0, true)
	pad_button(JOY_BUTTON_A, true)
	InputCoreDev.set_test_gamepad_family(GameData.InputPromptFamily.PLAY_STATION)
	assert_true(InputCore.is_pressed(&"cutscene_advance"))
	recorder.clear()
	InputCoreDev.inject_gamepad_connection(0, false)
	assert_false(InputCore.is_pressed(&"cutscene_advance"))
	assert_eq(InputCore.get_last_gamepad(), -1)
	assert_eq(InputCore.get_device(), InputCore.InputDevice.GAMEPAD)
	assert_eq(InputCore.get_prompt_family(), GameData.InputPromptFamily.PLAY_STATION)
	assert_eq(recorder.count("prompt"), 0)
	assert_eq(recorder.count("device"), 0)


func test_sources_of_two_gamepads() -> void:
	InputCoreDev.inject_gamepad_connection(0, true)
	InputCoreDev.inject_gamepad_connection(1, true)
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_A, true), 0)
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_A, true), 1)
	assert_eq(InputCore.get_last_gamepad(), 1)
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_A, false), 1)
	assert_true(InputCore.is_pressed(&"cutscene_advance"), "gamepad 0 still presses a")
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_A, true), 1)
	InputCoreDev.inject_gamepad_connection(1, false)
	assert_true(InputCore.is_pressed(&"cutscene_advance"), "the disconnection of gamepad 1 releases only its sources")
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_A, false), 0)
	assert_false(InputCore.is_pressed(&"cutscene_advance"))
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_LEFT_X, 0.8), 0)
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_LEFT_X, 0.0), 1)
	assert_true(InputCore.is_pressed(&"move_right"), "the axis input of gamepad 1 does not release gamepad 0's source")
	assert_almost_eq(InputCore.get_strength(&"move_right"), 0.8, 0.0001)
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_LEFT_X, 0.4), 1)
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_LEFT_X, 0.0), 0)
	assert_almost_eq(InputCore.get_strength(&"move_right"), 0.4, 0.0001, "gamepad 1's source stays pressed")
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_LEFT_X, 0.0), 1)
	assert_false(InputCore.is_pressed(&"move_right"))
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_A, true), -1)
	assert_eq(errors(), 1, "a negative gamepad ID")
	assert_false(InputCore.is_pressed(&"cutscene_advance"))


## The Godot limit of gamepads that hold sources at a time is 16.
func test_gamepad_over_the_limit_is_not_a_source() -> void:
	for gamepad: int in 17:
		InputCoreDev.inject_gamepad_connection(gamepad, true)
	for gamepad: int in 16:
		InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_A, true), gamepad)
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_LEFT_X, PAD_AXIS_DEADZONE * 0.5), 5)
	assert_eq(errors(), 0, "16 gamepads hold sources")
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_B, true), 16)
	assert_false(InputCore.is_pressed(&"jump"), "the button press of the 17th gamepad is not a source")
	assert_eq(errors(), 1, "the button press of the 17th gamepad")
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_B, false), 16)
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_LEFT_X, 0.8), 16)
	assert_false(InputCore.is_pressed(&"move_right"), "the axis value of the 17th gamepad is not a source")
	assert_eq(errors(), 1, "the axis value of the 17th gamepad")
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_LEFT_X, 0.0), 16)
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_A, false), 5)
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_B, true), 16)
	assert_false(InputCore.is_pressed(&"jump"), "gamepad 5 has an axis value that is not 0")
	assert_eq(errors(), 1, "gamepad 5 still holds input")
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_B, false), 16)
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_LEFT_X, 0.0), 5)
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_B, true), 16)
	assert_true(InputCore.is_pressed(&"jump"), "the press of the 17th gamepad is a source after gamepad 5 released all")
	assert_eq(errors(), 0)
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_LEFT_X, 0.8), 16)
	assert_true(InputCore.is_pressed(&"move_right"), "the axis value of the 17th gamepad is a source")
	assert_true(InputCore.is_pressed(&"cutscene_advance"), "the other gamepads still press a")
	InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_B, false), 16)
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_LEFT_X, 0.0), 16)
	for gamepad: int in 16:
		InputCoreDev.inject_device_input(pad_button_event(JOY_BUTTON_A, false), gamepad)
	assert_false(InputCore.is_pressed(&"jump"))
	assert_false(InputCore.is_pressed(&"move_right"))
	assert_false(InputCore.is_pressed(&"cutscene_advance"))
	assert_eq(errors(), 0)


func test_disconnection_forgets_the_last_axis_inputs_of_the_gamepad() -> void:
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	assert_true(InputCore.set_pad_buttons(&"back", PackedStringArray(["left_y-"])))
	InputCoreDev.inject_gamepad_connection(0, true)
	pad_axis(JOY_AXIS_LEFT_Y, -0.8)
	assert_eq(recorder.count("back"), 1)
	InputCoreDev.inject_gamepad_connection(0, false)
	InputCoreDev.inject_gamepad_connection(0, true)
	pad_axis(JOY_AXIS_LEFT_Y, -0.8)
	assert_eq(recorder.count("back"), 2, "the press after the reconnection is not a strength change")
	pad_axis(JOY_AXIS_LEFT_Y, 0.0)


func test_text_character_input_is_keyboard_mouse() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	recorder.clear()
	var text: InputEventKey = InputEventKey.new()
	text.unicode = "a".unicode_at(0)
	text.pressed = true
	InputCoreDev.inject_device_input(text)
	var devices: Array[InputCoreTestRecord] = recorder.of("device")
	assert_eq(devices.size(), 1)
	if devices.size() == 1:
		assert_eq(devices[0].device, InputCore.InputDevice.KEYBOARD_MOUSE)
	text.pressed = false
	InputCoreDev.inject_device_input(text)
	assert_eq(recorder.count("device"), 1)
