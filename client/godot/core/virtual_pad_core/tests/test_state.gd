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
	assert_true(no_direction(), "the joystick released its direction actions")
	assert_false(InputCore.is_pressed(FIRE_ACTION), "the button released its action")
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.ACTIVE)


func test_popup_makes_it_inactive() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	assert_vector(Vector2(0.5, 0.0))
	await open_popup(POPUP_COVER)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.INACTIVE)
	assert_true(no_direction())
	drag(0, stick_point(Vector2(RADIUS * 2.0, 0.0)))
	drag(0, stick_point(Vector2(RADIUS * 3.0, 0.0)))
	touch(0, false, stick_point(Vector2(RADIUS * 3.0, 0.0)))
	assert_eq(recorder.gestures(), 0, "the pointer's move and release make no gesture")
	assert_eq(counting_popup().inputs, 0, "the popup gets neither the moves nor the release")
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


func test_gamepad_device_makes_the_elements_not_visible_ui_elements() -> void:
	await open(LAYOUT_FIXED)
	assert_true(_elements_visible(), "Active elements are visible UI elements")
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	assert_true(_no_element_visible(), "Hidden elements are not visible UI elements")
	await run_frames()
	assert_true(_no_element_visible(), "they stay not visible")
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.ACTIVE)
	assert_true(_elements_visible(), "Active again, they are visible UI elements")
	await open_popup()
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.INACTIVE)
	assert_true(_elements_visible(), "Inactive elements are visible UI elements")
	UICore.close_all_popups()


func test_a_layout_opened_with_the_gamepad_device_has_no_visible_ui_element() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await open(LAYOUT_FIXED)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	assert_true(_no_element_visible())


func test_elements_become_not_visible_when_the_held_touch_is_released() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, center_of(FIRE))
	assert_true(InputCore.is_pressed(FIRE_ACTION))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	await run_frames()
	assert_true(_elements_visible(), "the elements stay visible UI elements while the touch is held")
	touch(0, false, center_of(FIRE))
	# The release is touch input, so device detection makes the device `Touch` again.
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_true(_no_element_visible(), "with the Gamepad device after the release they are not visible UI elements")
	assert_false(InputCore.is_pressed(FIRE_ACTION))


func test_hidden_elements_become_not_visible_after_the_held_touch_is_released() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, center_of(FIRE))
	# Without touch support the state stays `Hidden` through the release, which makes the device `Touch`.
	VirtualPadCoreDev.set_test_touch_support(false)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	await run_frames()
	assert_true(_elements_visible(), "the elements stay visible UI elements while the touch is held")
	drag(0, center_of(FIRE) + Vector2(10.0, 10.0))
	await run_frames()
	assert_true(_elements_visible(), "a move does not end it")
	touch(0, false, center_of(FIRE) + Vector2(10.0, 10.0))
	await run_frames()
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	assert_true(_no_element_visible(), "after the release they are not visible UI elements")
	assert_false(InputCore.is_pressed(FIRE_ACTION))

func test_a_touch_pressed_outside_the_areas_does_not_keep_hidden_elements_visible() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, Vector2(1000.0, 200.0))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_true(_no_element_visible(), "a press outside the areas was not consumed")
	touch(0, false, Vector2(1000.0, 200.0))


func test_elements_stay_visible_until_every_consumed_touch_is_released() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, center_of(FIRE))
	touch(1, true, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	VirtualPadCoreDev.set_test_touch_support(false)
	touch(1, false, stick_point(Vector2(RADIUS * 0.5, 0.0)))
	await run_frames()
	assert_true(_elements_visible(), "the other consumed touch is still held")
	touch(0, false, center_of(FIRE))
	await run_frames()
	assert_true(_no_element_visible())


func test_input_cancel_ends_the_held_touch_of_hidden_elements() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, center_of(FIRE))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await run_frames()
	assert_true(_elements_visible())
	InputCore.cancel_input()
	await run_frames()
	assert_true(_no_element_visible(), "InputCore discards the later input of that touch")


## Whether every element of the virtual pad is a visible UI element.
func _elements_visible() -> bool:
	return element(STICK).is_visible_in_tree() and element(FIRE).is_visible_in_tree()


## Whether no element of the virtual pad is a visible UI element.
func _no_element_visible() -> bool:
	return not element(STICK).is_visible_in_tree() and not element(FIRE).is_visible_in_tree()
