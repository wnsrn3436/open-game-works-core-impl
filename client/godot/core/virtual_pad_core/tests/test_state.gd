extends VirtualPadTestCase
## State: touch support, input device, open popups, input cancel.


func test_no_virtual_pad_is_hidden() -> void:
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	await open(LAYOUT_FIXED)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.ACTIVE)
	VirtualPadCore.close_layout()
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)


func test_without_touch_support_it_is_hidden_and_takes_no_pointer() -> void:
	VirtualPadCoreDev.set_test_touch_support(false)
	await open(LAYOUT_FIXED)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	assert_false(VirtualPadCore._pad.visible, "not drawn")
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	touch(1, true, center_of(FIRE))
	assert_true(no_direction())
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	touch(0, false, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	touch(1, false, center_of(FIRE))
	assert_eq(recorder.taps, 2, "the pointers are not consumed")


func test_input_device_change_hides_and_releases() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	touch(1, true, center_of(FIRE))
	assert_vector(Vector2(0.5, 0.0))
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	assert_false(VirtualPadCore._pad.visible)
	assert_true(no_direction(), "the joystick released its direction actions")
	assert_false(InputCore.is_pressed(FIRE_ACTION), "the button released its action")
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.ACTIVE)
	assert_true(VirtualPadCore._pad.visible)


func test_popup_makes_it_inactive() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_vector(Vector2(0.5, 0.0))
	await open_popup()
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.INACTIVE)
	assert_true(VirtualPadCore._pad.visible, "drawn while inactive")
	assert_true(no_direction())
	drag(0, stick_point(Vector2(RADIUS * 2.0, 0.0)))
	drag(0, stick_point(Vector2(RADIUS * 3.0, 0.0)))
	touch(0, false, stick_point(Vector2(RADIUS * 3.0, 0.0)))
	assert_eq(recorder.gestures(), 0, "the pointer's move and release make no gesture")
	assert_true(no_direction())
	UICore.close_all_popups()
	await run_frames()
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.ACTIVE)


func test_input_cancel_releases_and_a_new_press_takes_the_element() -> void:
	await open(LAYOUT_FLOATING)
	var stick: Control = element(STICK)
	var pressed_at: Vector2 = BASE_DEFAULT + Vector2(100.0, 100.0)
	touch(0, true, game_point(stick, pressed_at))
	drag(0, game_point(stick, pressed_at + Vector2(RADIUS, 0.0)))
	assert_vector(Vector2(1.0, 0.0))
	InputCore.cancel_input()
	await run_frames()
	assert_almost_eq(center_in(stick, stick_base()), BASE_DEFAULT, Vector2(EPSILON, EPSILON), "the base is back")
	assert_true(no_direction())
	drag(0, game_point(stick, pressed_at + Vector2(0.0, RADIUS)))
	assert_true(no_direction(), "the let-go pointer does not come back")
	touch(0, false, game_point(stick, pressed_at + Vector2(0.0, RADIUS)))
	var again: Vector2 = BASE_DEFAULT + Vector2(50.0, 50.0)
	touch(0, true, game_point(stick, again))
	assert_almost_eq(center_in(stick, stick_base()), again, Vector2(EPSILON, EPSILON), "a new pointer takes it")
	drag(0, game_point(stick, again + Vector2(0.0, -RADIUS)))
	assert_vector(Vector2(0.0, -1.0))
