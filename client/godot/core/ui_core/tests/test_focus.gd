extends "res://core/ui_core/tests/support/ui_test_case.gd"
## Focus: the focus mode, the focus target, view focus, `set_test_focus` and text input elements.

## Gamepad button `a` as the engine accept input. The engine default `ui_accept` has no gamepad button.
var _pad_accept: InputEventJoypadButton = null


func before_each() -> void:
	super()
	_pad_accept = null
	for event: InputEvent in InputMap.action_get_events(&"ui_accept"):
		var pad: InputEventJoypadButton = event as InputEventJoypadButton
		if pad != null and pad.button_index == JOY_BUTTON_A:
			return
	_pad_accept = InputEventJoypadButton.new()
	_pad_accept.button_index = JOY_BUTTON_A
	_pad_accept.device = -1
	InputMap.action_add_event(&"ui_accept", _pad_accept)


func after_each() -> void:
	if _pad_accept != null:
		InputMap.action_erase_event(&"ui_accept", _pad_accept)
	await super()


func _first(popup: Control) -> Button:
	return named_button(popup, "First")


func _second(popup: Control) -> Button:
	return named_button(popup, "Second")


func test_gamepad_focus_next_frame_and_accept_click() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_FOCUS, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var popup: UIPopup = popup_of(POPUP_FOCUS)
	ui_button_of(_second(popup)).set_on_click(click_of("second"))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_null(focus_owner(), "not in the frame of the change")
	await UnitTestCore.wait_frames(2)
	assert_eq(focus_owner(), _second(popup), "the initial focus element")
	await press_pad(JOY_BUTTON_A)
	await UnitTestCore.wait_frames(1)
	assert_eq(clicks, PackedStringArray(["second"]), "one click by the accept input")
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	await UnitTestCore.wait_frames(1)
	assert_null(focus_owner(), "no focus with touch")


func test_key_direction_starts_the_focus_mode() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_FOCUS, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var popup: UIPopup = popup_of(POPUP_FOCUS)
	ui_button_of(_first(popup)).set_on_click(click_of("first"))
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	await UnitTestCore.wait_frames(1)
	assert_null(focus_owner())
	await press_key(KEY_DOWN)
	assert_eq(focus_owner(), _second(popup), "the initial focus element, not moved")
	await press_key(KEY_UP)
	assert_eq(focus_owner(), _first(popup), "the next direction input moves the focus")
	await press_key(KEY_ENTER)
	await UnitTestCore.wait_frames(1)
	assert_eq(clicks, PackedStringArray(["first"]), "one click by the key accept input")
	await move_mouse(Vector2(10, 10))
	assert_null(focus_owner(), "a mouse move ends the focus mode")


func test_text_input_keys_do_not_start_the_focus_mode() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_TEXT, null, Callable()) == UICore.PopupOpenResult.OPENED)
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	var text: LineEdit = popup_of(POPUP_TEXT).find_child("Text", true, false) as LineEdit
	await tap_control(text)
	assert_eq(focus_owner(), text)
	await press_key(KEY_LEFT)
	assert_eq(focus_owner(), text, "no focus mode from a key of the text input element")
	assert_false(UICore._key_focus_mode)


func test_first_button_without_initial_focus_and_no_escape() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_NONMODAL, null, false))
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var popup: UIPopup = popup_of(POPUP_A)
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(2)
	assert_eq(focus_owner(), _first(popup), "the first UIButton")
	for i: int in 4:
		await press_pad(JOY_BUTTON_DPAD_RIGHT)
		await press_pad(JOY_BUTTON_DPAD_DOWN)
		assert_true(popup.is_ancestor_of(focus_owner()), "the focus stays in the popup")


func test_focus_comes_back_to_the_lower_popup() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var a: UIPopup = popup_of(POPUP_A)
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(2)
	await press_pad(JOY_BUTTON_DPAD_DOWN)
	assert_eq(focus_owner(), _second(a))
	assert_true(await UICore.open_popup(POPUP_FOCUS, null, Callable()) == UICore.PopupOpenResult.OPENED)
	await UnitTestCore.wait_frames(1)
	assert_eq(focus_owner(), _second(popup_of(POPUP_FOCUS)), "the focus element of B")
	await UICore.close_popup(popup_of(POPUP_FOCUS))
	await UnitTestCore.wait_frames(1)
	assert_eq(focus_owner(), _second(a), "the element of A that had the focus")


func test_no_focus_with_only_a_panel_without_modal() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_NONMODAL, null, false))
	ui_button_of(named_button(current(), "Button")).set_on_click(click_of("panel"))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(2)
	assert_null(focus_owner())
	await press_pad(JOY_BUTTON_A)
	assert_eq(clicks.size(), 0)


func test_view_focus_over_a_modal_popup() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var a_button: Button = add_button(UICore.UILayer.CUTSCENE, "a", Vector2(500, 500))
	var b_button: Button = add_button(UICore.UILayer.CUTSCENE, "b", Vector2(700, 500))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(2)
	var accepted: Array[Control] = []
	UICore.set_view_focus(UICore.FocusView.CUTSCENE, [a_button, b_button] as Array[Control], a_button,
			func(element: Control) -> void: accepted.append(element))
	await UnitTestCore.wait_frames(1)
	assert_eq(focus_owner(), a_button)
	for i: int in 3:
		await press_pad(JOY_BUTTON_DPAD_UP)
		await press_pad(JOY_BUTTON_DPAD_LEFT)
		assert_true(focus_owner() == a_button or focus_owner() == b_button, "the focus stays in the view focus")
	UICore.set_view_focus(UICore.FocusView.CUTSCENE, [a_button, b_button] as Array[Control], a_button,
			func(element: Control) -> void: accepted.append(element))
	await UnitTestCore.wait_frames(1)
	await press_pad(JOY_BUTTON_A)
	await UnitTestCore.wait_frames(1)
	assert_eq(clicks, PackedStringArray(["a"]), "one click of A")
	assert_eq(accepted, [a_button] as Array[Control], "one accept callback with A")
	var t_button: Button = add_button(UICore.UILayer.TUTORIAL, "t", Vector2(900, 500))
	UICore.set_view_focus(UICore.FocusView.TUTORIAL, [t_button] as Array[Control], t_button, Callable())
	await UnitTestCore.wait_frames(1)
	assert_eq(focus_owner(), t_button, "the Tutorial view focus is above")
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	await UnitTestCore.wait_frames(1)
	assert_eq(focus_owner(), system_buttons(system_popup())[0], "a system popup is above")
	UICore.close_all_popups()
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	UICore.set_view_focus(UICore.FocusView.TUTORIAL, [] as Array[Control], null, Callable())
	UICore.set_view_focus(UICore.FocusView.CUTSCENE, [] as Array[Control], null, Callable())
	await UnitTestCore.wait_frames(1)
	assert_true(popup_of(POPUP_A).is_ancestor_of(focus_owner()), "the modal popup after the view focus is cleared")


func test_view_focus_moves_across_canvas_layers() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var a_button: Button = add_button(UICore.UILayer.CUTSCENE, "a", Vector2(200, 500))
	var outside: Button = add_button(UICore.UILayer.CUTSCENE, "outside", Vector2(400, 500))
	var b_button: Button = add_button(UICore.UILayer.TUTORIAL, "b", Vector2(800, 500))
	var c_button: Button = add_button(UICore.UILayer.TUTORIAL, "c", Vector2(1000, 500))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(2)
	UICore.set_view_focus(UICore.FocusView.CUTSCENE, [a_button, b_button, c_button] as Array[Control], a_button,
			Callable())
	await UnitTestCore.wait_frames(1)
	assert_eq(focus_owner(), a_button)
	await press_pad(JOY_BUTTON_DPAD_RIGHT)
	assert_eq(focus_owner(), b_button, "past the element outside the view focus to the nearest one on another layer")
	await press_pad(JOY_BUTTON_DPAD_RIGHT)
	assert_eq(focus_owner(), c_button, "the engine neighbor on the same layer")
	await press_pad(JOY_BUTTON_DPAD_RIGHT)
	assert_eq(focus_owner(), c_button, "no element in that direction")
	await press_pad(JOY_BUTTON_DPAD_LEFT)
	await press_pad(JOY_BUTTON_DPAD_LEFT)
	assert_eq(focus_owner(), a_button, "no engine neighbor on the layer of B")
	await press_pad(JOY_BUTTON_DPAD_UP)
	assert_eq(focus_owner(), a_button, "no element above")
	b_button.visible = false
	await press_pad(JOY_BUTTON_DPAD_RIGHT)
	assert_eq(focus_owner(), c_button, "a hidden element is skipped")
	assert_eq(clicks.size(), 0, "a direction input clicks nothing")
	assert_eq(errors(), 0)
	outside.queue_free()


func test_key_view_focus_moves_across_canvas_layers() -> void:
	assert_true(await start())
	var a_button: Button = add_button(UICore.UILayer.CUTSCENE, "a", Vector2(500, 200))
	var b_button: Button = add_button(UICore.UILayer.TUTORIAL, "b", Vector2(500, 500))
	UICore.set_view_focus(UICore.FocusView.CUTSCENE, [a_button, b_button] as Array[Control], a_button, Callable())
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	await UnitTestCore.wait_frames(1)
	await press_key(KEY_DOWN)
	assert_eq(focus_owner(), a_button, "the focus mode start does not move the focus")
	await press_key(KEY_DOWN)
	assert_eq(focus_owner(), b_button, "down to the other layer")
	await press_key(KEY_UP)
	assert_eq(focus_owner(), a_button, "up to the other layer")
	await move_mouse(Vector2(10, 10))
	assert_null(focus_owner(), "a mouse move ends the focus mode")


func test_set_test_focus() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var popup: UIPopup = popup_of(POPUP_A)
	var outside: Button = add_button(UICore.UILayer.SCENE_UI, "outside")
	assert_false(UICoreDev.set_test_focus(_second(popup)), "not Gamepad")
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(2)
	assert_true(UICoreDev.set_test_focus(_second(popup)))
	assert_eq(focus_owner(), _second(popup))
	assert_false(UICoreDev.set_test_focus(outside), "outside the instance")
	assert_false(UICoreDev.set_test_focus(popup), "no UIButton")
	assert_eq(focus_owner(), _second(popup), "the focus stays")


func test_touched_text_input_keeps_the_engine_focus() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_TEXT, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var popup: UIPopup = popup_of(POPUP_TEXT)
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	var text: LineEdit = popup.find_child("Text", true, false) as LineEdit
	await tap_control(text)
	assert_eq(focus_owner(), text)
	await UnitTestCore.wait_frames(1)
	assert_eq(focus_owner(), text, "the next frame too")
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(2)
	assert_eq(focus_owner(), _first(popup), "the focus element of the focus target")


func test_gamepad_press_under_the_pass_list_block() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	ui_button_of(_first(popup_of(POPUP_A))).set_on_click(click_of("popup"))
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	var token: int = InputBlockCore.block("content", UICore.get_block_pass_list())
	await press_pad(JOY_BUTTON_A)
	await UnitTestCore.wait_frames(2)
	await press_pad(JOY_BUTTON_A)
	assert_eq(clicks.size(), 0, "no click of the popup button under the block")
	var labels: PackedStringArray = PackedStringArray([ReservedString.ui_exit_quit(), ReservedString.ui_exit_cancel()])
	assert_true(await UICore.open_system_popup(system_param(labels, [after_of("quit"), after_of("cancel")]), Callable()))
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	await UnitTestCore.wait_frames(1)
	await press_pad(JOY_BUTTON_X)
	await UnitTestCore.wait_frames(2)
	var buttons: Array[Button] = system_buttons(system_popup())
	assert_eq(focus_owner(), buttons[0], "the first button the frame after")
	await press_pad(JOY_BUTTON_DPAD_RIGHT)
	assert_eq(focus_owner(), buttons[1])
	await advance(CLICK_INTERVAL_MS)
	await press_pad(JOY_BUTTON_A)
	await UnitTestCore.wait_frames(1)
	assert_eq(after_calls, PackedStringArray(["cancel"]))
	InputBlockCore.unblock(token)
