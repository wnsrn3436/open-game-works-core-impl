extends "res://core/ui_core/tests/support/ui_test_case.gd"
## Back input: its order, back policies, exit confirm, back override and the back handler result.


func _exit_confirm_shown() -> bool:
	var popup: Control = system_popup()
	if popup == null:
		return false
	var record: UICore._POPUP = UICore._shown_record_of(popup)
	return record.system_param.body == ReservedString.ui_exit_confirm()


func test_root_panel_close_opens_exit_confirm_by_platform() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_R))
	for platform: String in PackedStringArray(["android", "windows", "macos", "linux"]):
		await back_on(platform)
		assert_true(_exit_confirm_shown(), platform)
		assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_R]), "no close_panel")
		UICore.close_all_popups()
	for platform: String in PackedStringArray(["ios", "web"]):
		await back_on(platform)
		assert_false(UICore.is_system_popup_visible(), platform)
		assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_R]))


func test_custom_root_panel_gets_on_back() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_CUSTOM))
	await press_back()
	assert_eq(LOG.count(PANEL_CUSTOM + ":on_back"), 1)
	assert_false(UICore.is_system_popup_visible())


func test_back_policies_of_popups_and_panels() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panel(PANEL_B, null, false))
	assert_true(await UICore.open_popup(POPUP_IGNORE, null, Callable()) == UICore.PopupOpenResult.OPENED)
	await press_back()
	assert_not_null(popup_of(POPUP_IGNORE), "Ignore keeps the popup")
	assert_true(await UICore.open_popup(POPUP_CUSTOM, null, Callable()) == UICore.PopupOpenResult.OPENED)
	await press_back()
	assert_eq(LOG.count(POPUP_CUSTOM + ":on_back"), 1, "Custom calls on_back of the top popup")
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	await press_back()
	await UnitTestCore.wait_frames(2)
	assert_null(popup_of(POPUP_A), "Close closes the top popup")
	assert_not_null(popup_of(POPUP_CUSTOM))
	UICore.close_all_popups()
	await press_back()
	await UnitTestCore.wait_frames(3)
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_A]), "Close closes the current panel")


func test_ignore_panel_keeps_the_panel() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panel(PANEL_IGNORE, null, false))
	await press_back()
	await UnitTestCore.wait_frames(2)
	assert_eq(UICore.get_current_panel_key(), PANEL_IGNORE)


func test_exit_confirm_texts_and_its_close() -> void:
	assert_true(await start())
	await back_on("android")
	assert_true(_exit_confirm_shown())
	var buttons: Array[Button] = system_buttons(system_popup())
	assert_eq(buttons.size(), 2)
	assert_eq(buttons[0].text, LocalizationCore.get_text(ReservedString.ui_exit_quit()))
	assert_eq(buttons[1].text, LocalizationCore.get_text(ReservedString.ui_exit_cancel()))
	assert_true(await UICore.open_popup(POPUP_NONMODAL, null, Callable()) == UICore.PopupOpenResult.OPENED)
	await advance(CLICK_INTERVAL_MS)
	await press_back()
	await UnitTestCore.wait_frames(2)
	assert_false(UICore.is_system_popup_visible(), "back input closes the exit confirm")
	assert_not_null(popup_of(POPUP_NONMODAL), "only that popup")
	UICore.close_all_popups()
	await back_on("android")
	assert_true(_exit_confirm_shown())
	await advance(CLICK_INTERVAL_MS)
	await tap_control(system_buttons(system_popup())[1])
	assert_false(UICore.is_system_popup_visible(), "the cancel button closes it")


func test_exit_quit_publishes_exit_confirmed() -> void:
	assert_true(await start())
	var latch := UnitTestCore.latch_event(ExitConfirmedEvent)
	await back_on("windows")
	await tap_control(system_buttons(system_popup())[0])
	assert_true(await UnitTestCore.wait_latch(latch))


func test_back_before_prepare_does_nothing() -> void:
	assert_true(await start(true, false))
	assert_false(handle_back_on("android"))
	await back_on("android")
	assert_false(UICore.is_system_popup_visible())
	assert_eq(errors() + warns(), 0)


func test_back_without_popup_and_panel() -> void:
	assert_true(await start())
	await back_on("linux")
	assert_true(_exit_confirm_shown())
	UICore.close_all_popups()
	await back_on("ios")
	assert_false(UICore.is_system_popup_visible())


func test_back_handler_results() -> void:
	assert_true(await start())
	assert_false(handle_back_on("web"), "nothing to handle on web")
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panel(PANEL_CUSTOM, null, false))
	assert_false(handle_back_on("web"), "the current panel took it")
	assert_true(await UICore.open_popup(POPUP_IGNORE, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(UICore._handle_back(), "an open popup took it")
	UICore.close_all_popups()
	var gate: GATE = LOG.add_gate(POPUP_A)
	var popup: CALL = CALL.new()
	popup.open_popup(POPUP_A)
	await UnitTestCore.wait_frames(2)
	assert_true(UICore._handle_back(), "during a popup flow")
	gate.open()
	await finish(popup)
	UICore.close_all_popups()
	var panel_gate: GATE = LOG.add_gate(PANEL_B)
	var panel: CALL = CALL.new()
	panel.open_panel(PANEL_B)
	await UnitTestCore.wait_frames(2)
	assert_true(UICore._handle_back(), "during a panel transition")
	panel_gate.open()
	await finish(panel)
	UICore.set_back_override(click_of("override"))
	assert_true(UICore._handle_back(), "the back override took it")
	UICore.set_back_override(Callable())
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_true(UICore._handle_back(), "a system popup took it")
	UICore.close_all_popups()
	UICore.reset_panel_stack()
	assert_true(handle_back_on("windows"), "the exit confirm opened")
	UICore.close_all_popups()


func test_back_during_a_system_popup_open_flow() -> void:
	set_string("UICore.systemPopupResource", POPUP_TWEEN)
	assert_true(await start())
	var opening: CALL = CALL.new()
	opening.open_system_popup(one_button_param())
	await UnitTestCore.wait_frames(1)
	assert_false(opening.done, "in the open tween")
	assert_true(UICore._handle_back())
	assert_true(UICore.is_system_popup_visible(), "back input is ignored")
	await finish(opening)
	assert_true(opening.ok)


func test_back_override() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panel(PANEL_CUSTOM, null, false))
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	UICore.set_back_override(click_of("override"))
	await press_back()
	assert_eq(clicks, PackedStringArray(["override"]))
	assert_not_null(popup_of(POPUP_A), "the popup back policy is not used")
	assert_eq(LOG.count(PANEL_CUSTOM + ":on_back"), 0)
	assert_true(await UICore.open_system_popup(
			system_param(PackedStringArray([ReservedString.ui_exit_quit()]), [after_of("system")], 0), Callable()))
	await press_back()
	assert_eq(clicks.size(), 1, "the system popup takes the back input")
	assert_eq(after_calls, PackedStringArray(["system"]))
	UICore.set_back_override(Callable())
	await advance(CLICK_INTERVAL_MS)
	await press_back()
	await UnitTestCore.wait_frames(2)
	assert_null(popup_of(POPUP_A), "back input order after the override is cleared")
