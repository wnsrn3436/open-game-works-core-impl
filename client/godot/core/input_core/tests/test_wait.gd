extends InputCoreTestCase
## `wait_key`, `wait_pad_button` and their cancel.

const AREA: Rect2 = Rect2(1100.0, 500.0, 200.0, 200.0)


func test_wait_key_takes_the_next_key_press() -> void:
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	start_wait_key()
	key(KEY_J, true, true)
	assert_eq(key_result, PENDING, "a key repeat is not taken")
	key(KEY_J, true)
	assert_eq(key_result, "J")
	assert_false(InputCore.is_pressed(&"jump"))
	key(KEY_J, false)
	start_wait_key()
	key(KEY_ESCAPE, true)
	assert_eq(key_result, "Escape")
	assert_eq(recorder.count("back"), 0)
	key(KEY_ESCAPE, false)
	var button: Button = make_button(AREA)
	assert_eq(button.pressed.connect(recorder.on_button_pressed), OK)
	button.grab_focus()
	start_wait_key()
	key(KEY_SPACE, true)
	key(KEY_SPACE, false)
	assert_eq(key_result, "Space")
	assert_eq(recorder.count("button"), 0, "the UI does not get the press")


func test_wait_key_takes_a_mouse_button() -> void:
	var button: Button = make_button(AREA)
	assert_eq(button.pressed.connect(recorder.on_button_pressed), OK)
	assert_true(InputCore.set_keys(&"fire", PackedStringArray(["mouse_left"])))
	start_wait_key()
	touch(0, true, CENTER)
	touch(0, false, CENTER)
	assert_eq(key_result, PENDING, "the mouse input the engine made from touch is not taken")
	start_wait_key()
	assert_eq(errors(), 1, "wait_key while waiting")
	recorder.clear()
	mouse_button(MOUSE_BUTTON_LEFT, true, CENTER)
	assert_eq(key_result, "mouse_left")
	assert_false(InputCore.is_pressed(&"fire"))
	mouse_button(MOUSE_BUTTON_LEFT, false, CENTER)
	assert_eq(recorder.count("tap"), 0)
	assert_eq(recorder.count("button"), 0)
	start_wait_key()
	mouse_button(MOUSE_BUTTON_RIGHT, true, CENTER + Vector2(400, 0))
	assert_eq(key_result, "mouse_right")


func test_wait_key_does_not_take_a_key_press_without_a_key_name() -> void:
	start_wait_key()
	var nameless: InputEventKey = InputEventKey.new()
	nameless.unicode = "a".unicode_at(0)
	nameless.pressed = true
	InputCoreDev.inject_device_input(nameless)
	assert_eq(key_result, PENDING, "keycode and physical keycode are both KEY_NONE")
	nameless.pressed = false
	InputCoreDev.inject_device_input(nameless)
	var physical: InputEventKey = InputEventKey.new()
	physical.physical_keycode = KEY_H
	physical.pressed = true
	InputCoreDev.inject_device_input(physical)
	assert_eq(key_result, "H", "the physical keycode names a key without a keycode")
	physical.pressed = false
	InputCoreDev.inject_device_input(physical)


func test_wait_key_while_waiting_returns_key_none() -> void:
	start_wait_key()
	var second: String = await InputCore.wait_key()
	assert_eq(second, "")
	assert_eq(errors(), 1)
	assert_eq(key_result, PENDING, "the first wait goes on")
	key(KEY_H, true)
	assert_eq(key_result, "H")


func test_cancel_wait_key_ends_both_waits() -> void:
	start_wait_key()
	start_wait_pad_button()
	InputCore.cancel_wait_key()
	assert_eq(key_result, "")
	assert_eq(pad_result, "")


func test_release_ends_the_waits_with_none() -> void:
	start_wait_key()
	start_wait_pad_button()
	InputCore.release()
	assert_eq(key_result, "")
	assert_eq(pad_result, "")


func test_wait_pad_button_takes_the_next_gamepad_button() -> void:
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	start_wait_pad_button()
	key(KEY_J, true)
	assert_eq(pad_result, PENDING)
	assert_true(InputCore.is_pressed(&"jump"), "a key is not taken by wait_pad_button")
	key(KEY_J, false)
	pad_button(JOY_BUTTON_B, true)
	assert_eq(pad_result, "b")
	assert_eq(recorder.count("back"), 0)
	assert_false(InputCore.is_pressed(&"jump"))
	pad_button(JOY_BUTTON_B, false)
	start_wait_pad_button()
	var second: String = await InputCore.wait_pad_button()
	assert_eq(second, "")
	assert_eq(errors(), 1)
	pad_button(JOY_BUTTON_DPAD_LEFT, true)
	assert_eq(pad_result, "dpad_left")


func test_wait_pad_button_press_does_not_reach_the_focused_ui_element() -> void:
	var accept: InputEventJoypadButton = pad_button_event(JOY_BUTTON_A)
	accept.device = -1
	InputMap.action_add_event(&"ui_accept", accept)
	var button: Button = make_button(AREA)
	assert_eq(button.pressed.connect(recorder.on_button_pressed), OK)
	button.grab_focus()
	start_wait_pad_button()
	pad_button(JOY_BUTTON_A, true)
	assert_eq(pad_result, "a")
	pad_button(JOY_BUTTON_A, false)
	assert_eq(recorder.count("button"), 0, "the UI does not get the press")
	assert_false(InputCore.is_pressed(&"cutscene_advance"))
	pad_button(JOY_BUTTON_A, true)
	pad_button(JOY_BUTTON_A, false)
	assert_eq(recorder.count("button"), 1, "without a wait the focused button gets the gamepad accept input")


func test_wait_pad_button_takes_an_axis_direction_strength_with_the_deadzone() -> void:
	assert_true(UnitTestCore.set_test_settings("InputCore.padAxisDeadzone", PAD_AXIS_WAIT_THRESHOLD + 0.1))
	assert_true(restart_input_core())
	start_wait_pad_button()
	pad_axis(JOY_AXIS_LEFT_X, PAD_AXIS_WAIT_THRESHOLD + 0.05)
	assert_eq(pad_result, PENDING, "a size at the threshold but below the deadzone is strength 0")
	pad_axis(JOY_AXIS_LEFT_X, PAD_AXIS_WAIT_THRESHOLD + 0.15)
	assert_eq(pad_result, "left_x+")
	pad_axis(JOY_AXIS_LEFT_X, 0.0)


func test_wait_pad_button_takes_an_axis_direction_crossing_the_threshold() -> void:
	start_wait_pad_button()
	pad_axis(JOY_AXIS_LEFT_X, PAD_AXIS_WAIT_THRESHOLD - 0.2)
	assert_eq(pad_result, PENDING)
	pad_axis(JOY_AXIS_LEFT_X, PAD_AXIS_WAIT_THRESHOLD + 0.1)
	assert_eq(pad_result, "left_x+")
	assert_almost_eq(InputCore.get_strength(&"move_right"), PAD_AXIS_WAIT_THRESHOLD - 0.2, 0.0001,
		"the taken input does not change the action state")
	start_wait_pad_button()
	pad_axis(JOY_AXIS_LEFT_X, PAD_AXIS_WAIT_THRESHOLD + 0.3)
	assert_eq(pad_result, PENDING, "a value that stays at or above the threshold is not taken")
	pad_axis(JOY_AXIS_LEFT_X, 0.0)
	pad_axis(JOY_AXIS_LEFT_X, -PAD_AXIS_WAIT_THRESHOLD)
	assert_eq(pad_result, "left_x-")
	start_wait_pad_button()
	pad_axis(JOY_AXIS_TRIGGER_LEFT, 1.0)
	assert_eq(pad_result, "trigger_left+")
