extends "res://core/ui_core/tests/support/ui_test_case.gd"
## System popups: buttons, back button, layout, open result and scroll.

var _order: PackedStringArray = PackedStringArray()


func test_button_calls_hidden_then_button_callback() -> void:
	assert_true(await start())
	assert_true(await UICore.open_system_popup(one_button_param("button"), hidden_of("hidden")))
	await tap_control(system_buttons(system_popup())[0])
	assert_eq(hidden_calls, PackedStringArray(["hidden"]))
	assert_eq(after_calls, PackedStringArray(["button"]))
	await advance(CLICK_INTERVAL_MS)
	assert_eq(after_calls.size(), 1, "once")


func test_hidden_runs_before_the_button_callback() -> void:
	assert_true(await start())
	var param: SystemPopupParam = system_param(PackedStringArray([ReservedString.ui_exit_quit()]), [_record.bind("button")])
	assert_true(await UICore.open_system_popup(param, _record.bind("hidden")))
	await tap_control(system_buttons(system_popup())[0])
	assert_eq(_order, PackedStringArray(["hidden", "button"]))



func _record(label: String) -> void:
	_order.append(label)


func test_no_back_button_ignores_back_input() -> void:
	assert_true(await start())
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	await press_back()
	assert_true(UICore.is_system_popup_visible())


func test_open_ends_when_the_open_flow_ends() -> void:
	assert_true(await start())
	assert_true(await UICore.open_system_popup(one_button_param(), hidden_of("hidden")))
	assert_true(UICore.is_system_popup_visible())
	assert_true(system_popup().visible)
	assert_eq(hidden_calls.size(), 0)


func test_button_layout() -> void:
	assert_true(await start())
	for count: int in PackedInt32Array([1, 2, 3]):
		var labels: PackedStringArray = PackedStringArray()
		for i: int in count:
			labels.append(ReservedString.ui_exit_quit())
		assert_true(await UICore.open_system_popup(system_param(labels), Callable()))
		await UnitTestCore.wait_frames(2)
		var popup: Control = system_popup()
		var area: Rect2 = popup.get_global_rect()
		var buttons: Array[Button] = system_buttons(popup)
		var rects: Array[Rect2] = []
		for button: Button in buttons:
			var rect: Rect2 = button.get_global_rect()
			assert_true(area.encloses(rect), "inside the popup area")
			rects.append(rect)
		if count == 1:
			assert_almost_eq(rects[0].get_center().x, area.get_center().x, 1.0, "one button in the middle")
		else:
			var gap: float = rects[1].position.x - rects[0].end.x
			assert_true(gap > 0.0, "no overlap")
			for i: int in range(1, count):
				assert_almost_eq(rects[i].position.x - rects[i - 1].end.x, gap, 1.0, "even spacing")
		UICore.close_all_popups()


func test_scroll_with_direction_input() -> void:
	assert_true(await start())
	var param: SystemPopupParam = one_button_param()
	var lines: PackedStringArray = PackedStringArray()
	for i: int in 200:
		lines.append("line %d" % i)
	param.extra_text = "\n".join(lines)
	assert_true(await UICore.open_system_popup(param, Callable()))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(3)
	var view: UICore._SYSTEM_VIEW = UICore._shown_system[0].system_view as UICore._SYSTEM_VIEW
	assert_eq(view.scroll.scroll_vertical, 0)
	await press_pad(JOY_BUTTON_DPAD_DOWN)
	assert_eq(view.scroll.scroll_vertical, int(SCROLL_STEP))
	assert_eq(focus_owner(), system_buttons(system_popup())[0], "the focus stays")
	var bar: VScrollBar = view.scroll.get_v_scroll_bar()
	view.scroll.scroll_vertical = int(bar.max_value)
	var end: int = view.scroll.scroll_vertical
	await press_pad(JOY_BUTTON_DPAD_DOWN)
	assert_eq(view.scroll.scroll_vertical, end, "the end stays")
