extends VirtualPadTestCase
## A `SceneUI` button under a button area: a real mouse, mouse input the engine made from touch (on in the core
## project), input device changes and popups.

const OUTSIDE: Vector2 = Vector2(1000.0, 200.0)


func before_each() -> void:
	await super()
	assert_true(Input.is_emulating_mouse_from_touch(), "the engine makes mouse input from touch")


func test_keyboard_mouse_click_reaches_the_button_below() -> void:
	await open(LAYOUT_FIXED)
	var button: VirtualPadTestButton = make_scene_button(area_of(element(FIRE)))
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	mouse_button(true, center_of(FIRE))
	assert_false(InputCore.is_pressed(FIRE_ACTION), "the press changes no action")
	mouse_button(false, center_of(FIRE))
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	assert_eq(button.clicks, 1, "the SceneUI button is clicked")


func test_touch_under_a_side_popup_reaches_the_button_below() -> void:
	await open(LAYOUT_FIXED)
	var button: VirtualPadTestButton = make_scene_button(area_of(element(FIRE)))
	await open_popup(POPUP_SIDE)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.INACTIVE)
	touch(0, true, center_of(FIRE))
	assert_false(InputCore.is_pressed(FIRE_ACTION), "the press changes no action")
	touch(0, false, center_of(FIRE))
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	assert_eq(button.clicks, 1, "the SceneUI button is clicked")
	assert_eq(counting_popup().inputs, 0, "the popup gets nothing")
	UICore.close_all_popups()


func test_touch_moved_out_of_a_button_area_does_not_reach_the_button_below() -> void:
	await open(LAYOUT_FIXED)
	var button: VirtualPadTestButton = make_scene_button(area_of(element(FIRE)))
	touch(0, true, center_of(FIRE))
	assert_true(InputCore.is_pressed(FIRE_ACTION))
	drag(0, OUTSIDE)
	touch(0, false, OUTSIDE)
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	touch(0, true, center_of(FIRE))
	assert_true(InputCore.is_pressed(FIRE_ACTION))
	drag(0, OUTSIDE)
	drag(0, center_of(FIRE) + Vector2(10.0, 10.0))
	touch(0, false, center_of(FIRE) + Vector2(10.0, 10.0))
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	assert_eq(button.inputs, 0, "the SceneUI button gets no input")
	assert_eq(button.clicks, 0, "the SceneUI button is not clicked")


func test_popup_between_press_and_release_keeps_the_pointer_from_the_ui() -> void:
	await open(LAYOUT_FIXED)
	var button: VirtualPadTestButton = make_scene_button(area_of(element(FIRE)))
	touch(0, true, center_of(FIRE))
	assert_true(InputCore.is_pressed(FIRE_ACTION))
	await open_popup(POPUP_SIDE)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.INACTIVE)
	assert_false(InputCore.is_pressed(FIRE_ACTION), "the popup releases the action")
	drag(0, OUTSIDE)
	drag(0, center_of(FIRE) + Vector2(10.0, 10.0))
	touch(0, false, center_of(FIRE) + Vector2(10.0, 10.0))
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	assert_eq(button.inputs, 0, "the SceneUI button gets no input")
	assert_eq(button.clicks, 0, "the SceneUI button is not clicked")
	assert_eq(counting_popup().inputs, 0, "the popup the pointer moved over gets nothing")
	assert_eq(recorder.gestures(), 0, "no gesture")
	UICore.close_all_popups()


func test_touch_with_the_gamepad_device_clicks_the_button_below_and_presses_the_action() -> void:
	await open(LAYOUT_FIXED)
	var button: VirtualPadTestButton = make_scene_button(area_of(element(FIRE)))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	touch(0, true, center_of(FIRE))
	assert_true(InputCore.is_pressed(FIRE_ACTION), "the touch makes the device Touch and the button takes it")
	touch(0, false, center_of(FIRE))
	assert_false(InputCore.is_pressed(FIRE_ACTION), "the release releases the action")
	assert_eq(button.clicks, 1, "the mouse input made from touch before the device change clicks the SceneUI button")


func test_device_change_while_held_keeps_the_pointer_from_the_button_below() -> void:
	await open(LAYOUT_FIXED)
	var button: VirtualPadTestButton = make_scene_button(area_of(element(FIRE)))
	touch(0, true, center_of(FIRE))
	assert_true(InputCore.is_pressed(FIRE_ACTION))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	drag(0, center_of(FIRE) + Vector2(10.0, 10.0))
	drag(0, center_of(FIRE) + Vector2(20.0, 20.0))
	touch(0, false, center_of(FIRE) + Vector2(20.0, 20.0))
	assert_eq(button.inputs, 0, "the SceneUI button gets no input")
	assert_eq(button.clicks, 0, "the SceneUI button is not clicked")
	assert_false(InputCore.is_pressed(FIRE_ACTION), "the pointer the button let go presses nothing")
