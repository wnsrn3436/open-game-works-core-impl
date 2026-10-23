extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## Input: the input restriction, the `AnchorTap` condition and its order with the click callback, and the gamepad
## view focus.


func _focus_owner() -> Control:
	return get_viewport().gui_get_focus_owner()


func test_restrict_input_lets_only_the_anchor_and_the_system_popup_take_taps() -> void:
	assert_true(await start())
	var anchor: Button = add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	var outside: Button = add_anchor("tc_outside", Rect2(100, 600, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	assert_true(has_block())
	await click(outside)
	assert_eq(clicks, PackedStringArray())
	await open_system_popup()
	await click(system_popup_button())
	assert_false(UICore.is_system_popup_visible())
	await frames(2)
	respond_saved(id_of("[tutorial_anchor]"), 1)
	await click(anchor)
	assert_eq(clicks, PackedStringArray(["tc_anchor"]))
	assert_eq(current_text(), "[tutorial_anchor]:2")


func test_an_anchor_tap_ends_the_step_and_clicks_the_anchor_but_a_release_outside_does_not() -> void:
	assert_true(await start())
	var anchor: Button = add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	await drag_tap(center_of(anchor), Vector2(100, 650))
	assert_eq(current_text(), "[tutorial_anchor]:1")
	respond_saved(id_of("[tutorial_anchor]"), 1)
	await click(anchor)
	assert_eq(clicks, PackedStringArray(["tc_anchor"]))
	assert_eq(current_text(), "[tutorial_anchor]:2")


func test_the_click_callback_sees_the_step_and_the_next_step_starts_after_it() -> void:
	assert_true(await start())
	var anchor: Button = add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	respond_saved(id_of("[tutorial_anchor]"), 1)
	clicks = PackedStringArray()
	UnitTestCore.tap(center_of(anchor))
	await frames(1)
	assert_eq(current_in_click, PackedStringArray(["[tutorial_anchor]:1"]))
	assert_eq(events, PackedStringArray(["started:[tutorial_anchor]:1", "started:[tutorial_anchor]:2"]))
	assert_eq(clicks, PackedStringArray(["tc_anchor"]))


func test_the_gamepad_accept_on_the_anchor_clicks_it_once_and_then_ends_the_step() -> void:
	assert_true(await start())
	add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await frames(3)
	assert_eq(_focus_owner(), TutorialCore._shown.element)
	respond_saved(id_of("[tutorial_anchor]"), 1)
	await press_pad(JOY_BUTTON_A)
	assert_eq(clicks, PackedStringArray(["tc_anchor"]))
	assert_eq(current_in_click, PackedStringArray(["[tutorial_anchor]:1"]))
	assert_eq(current_text(), "[tutorial_anchor]:2")


func test_skip_in_the_click_callback_completes_without_the_next_step() -> void:
	assert_true(await start())
	var anchor: Button = add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	skip_in_click = true
	respond_saved(id_of("[tutorial_anchor]"), 3)
	await click(anchor)
	assert_eq(events, PackedStringArray(["started:[tutorial_anchor]:1", "completed:[tutorial_anchor]:true"]))
	assert_false(TutorialCore.is_running())


func test_the_gamepad_focus_of_an_advance_step_is_the_advance_button_and_accept_ends_it() -> void:
	assert_true(await start())
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_first]"])))
	assert_true(await wait_shown())
	await frames(2)
	assert_eq(_focus_owner(), view().advance_button)
	await press_pad(JOY_BUTTON_A)
	assert_eq(current_text(), "[tutorial_first]:2")


func test_cue_and_requirement_steps_have_no_tutorial_view_focus() -> void:
	assert_true(await start())
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_cue]"])))
	assert_true(await wait_shown())
	assert_false(TutorialCore._shown.has_focus)
	assert_true(TutorialCore.notify_cue(GameData.TutorialCue.OPENED))
	assert_true(await wait_shown())
	assert_eq(current_text(), "[tutorial_cue]:2")
	assert_false(TutorialCore._shown.has_focus)


func test_an_anchor_tap_anchor_without_a_ui_button_focuses_only_the_skip_button() -> void:
	assert_true(await start())
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	add_anchor("tc_plain", Rect2(560, 300, 160, 60), 0, false)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_plain]"])))
	assert_true(await wait_shown())
	await frames(2)
	assert_eq(errors(), 0, "gamepadSupported is false")
	assert_eq(_focus_owner(), view().skip_button)
	respond_saved(id_of("[tutorial_plain]"), 1)
	await press_pad(JOY_BUTTON_A)
	assert_eq(events, PackedStringArray(["started:[tutorial_plain]:1", "completed:[tutorial_plain]:true"]))


func test_with_gamepad_supported_an_anchor_without_a_ui_button_logs_its_name() -> void:
	set_value("gamepadSupported", true)
	assert_true(await start())
	add_anchor("tc_plain", Rect2(560, 300, 160, 60), 0, false)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_plain]"])))
	assert_true(await wait_shown())
	assert_eq(errors(), 1)


func test_direction_input_moves_the_focus_to_the_skip_button_and_accept_skips() -> void:
	assert_true(await start())
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	await frames(2)
	assert_eq(_focus_owner(), TutorialCore._shown.element)
	for direction: JoyButton in [JOY_BUTTON_DPAD_UP, JOY_BUTTON_DPAD_RIGHT, JOY_BUTTON_DPAD_DOWN, JOY_BUTTON_DPAD_LEFT]:
		if _focus_owner() == view().skip_button:
			break
		await press_pad(direction)
	assert_eq(_focus_owner(), view().skip_button)
	respond_saved(id_of("[tutorial_anchor]"), 3)
	await press_pad(JOY_BUTTON_A)
	assert_eq(events, PackedStringArray(["started:[tutorial_anchor]:1", "completed:[tutorial_anchor]:true"]))


func test_an_anchor_tap_of_one_touch_is_kept_while_another_touch_presses_inside_or_outside() -> void:
	assert_true(await start())
	var anchor: Button = add_anchor("tc_plain", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_plain]"])))
	assert_true(await wait_shown())
	var inside: Vector2 = center_of(anchor)
	var outside: Vector2 = Vector2(100, 650)
	_touch(0, true, inside)
	_touch(1, true, outside)
	respond_saved(id_of("[tutorial_plain]"), 1)
	_touch(0, false, inside)
	await frames(2)
	assert_eq(events, PackedStringArray(["started:[tutorial_plain]:1", "completed:[tutorial_plain]:false"]))
	_touch(1, false, outside)
	await frames(2)


func test_an_anchor_tap_of_one_touch_ends_the_step_when_another_touch_pressed_inside_after_it() -> void:
	assert_true(await start())
	var anchor: Button = add_anchor("tc_plain", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_plain]"])))
	assert_true(await wait_shown())
	var inside: Vector2 = center_of(anchor)
	_touch(0, true, inside)
	_touch(1, true, inside + Vector2(20, 0))
	respond_saved(id_of("[tutorial_plain]"), 1)
	_touch(0, false, inside)
	await frames(2)
	assert_eq(events, PackedStringArray(["started:[tutorial_plain]:1", "completed:[tutorial_plain]:false"]))
	_touch(1, false, inside + Vector2(20, 0))
	await frames(2)
	assert_eq(events, PackedStringArray(["started:[tutorial_plain]:1", "completed:[tutorial_plain]:false"]))


func _touch(index: int, pressed: bool, position: Vector2) -> void:
	var event: InputEventScreenTouch = InputEventScreenTouch.new()
	event.index = index
	event.pressed = pressed
	event.position = position
	InputCoreDev.inject_device_input(event)
