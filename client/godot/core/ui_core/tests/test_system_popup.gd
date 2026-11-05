extends "res://core/ui_core/tests/support/ui_test_case.gd"
## System popups: buttons, back button, system popup areas and layout, open result and scroll.

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


func test_areas_taken_from_the_root_of_the_code_made_screen() -> void:
	assert_true(await start())
	await _assert_areas_from_the_root()


func test_areas_taken_from_a_root_that_is_not_a_system_popup_class() -> void:
	set_string("UICore.systemPopupResource", FRAME)
	assert_true(await start())
	await _assert_areas_from_the_root()


func test_both_areas_set() -> void:
	set_string("UICore.systemPopupResource", SYSTEM_AREAS)
	assert_true(await start())
	var popup: Control = await _open_three_buttons()
	_assert_inside(_body_rect(popup), _child_rect(popup, "Body"), "the body in the body area")
	_assert_buttons_inside(popup, _child_rect(popup, "Buttons"), "the buttons in the button area")


func test_only_the_button_area_set() -> void:
	set_string("UICore.systemPopupResource", SYSTEM_BUTTON_AREA)
	assert_true(await start())
	var popup: Control = await _open_three_buttons()
	var buttons_area: Rect2 = _child_rect(popup, "Buttons")
	_assert_buttons_inside(popup, buttons_area, "the buttons in the button area")
	var above: Rect2 = popup.get_global_rect()
	above.size.y = buttons_area.position.y - above.position.y
	_assert_inside(_body_rect(popup), above, "the body in the root above the button area")
	assert_true(_body_rect(popup).size.y > 0.0, "the body has a height")


func test_only_the_body_area_set() -> void:
	set_string("UICore.systemPopupResource", SYSTEM_BODY_AREA)
	assert_true(await start())
	var popup: Control = await _open_three_buttons()
	_assert_inside(_body_rect(popup), _child_rect(popup, "Body"), "the body in the body area")
	_assert_buttons_along_the_bottom(popup)


func test_one_button_at_the_center_of_its_button_area() -> void:
	set_string("UICore.systemPopupResource", SYSTEM_AREAS)
	assert_true(await start())
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	await UnitTestCore.wait_frames(2)
	var popup: Control = system_popup()
	var area: Rect2 = _child_rect(popup, "Buttons")
	var button: Rect2 = system_buttons(popup)[0].get_global_rect()
	assert_almost_eq(button.get_center().x, area.get_center().x, 1.0, "horizontal center of the button area")
	assert_true(area.grow(1.0).encloses(button), "inside the button area")


func test_buttons_stay_inside_a_button_area_smaller_than_their_minimum_size() -> void:
	set_string("UICore.systemPopupResource", SYSTEM_SMALL_BUTTON_AREA)
	assert_true(await start())
	var popup: Control = await _open_three_buttons()
	var area: Control = popup.get_node("Buttons") as Control
	assert_true(area.size.y < 56.0, "lower than a button row of the root strip")
	_assert_buttons_inside(popup, area.get_global_rect(), "the buttons in the small button area")
	for button: Button in system_buttons(popup):
		button.text = "a button label much longer than the width of its button area"
	await UnitTestCore.wait_frames(2)
	_assert_buttons_inside(popup, area.get_global_rect(), "long labels in the small button area")
	area.offset_left = -20.0
	area.offset_right = 20.0
	area.offset_top = -4.0
	area.offset_bottom = 4.0
	await UnitTestCore.wait_frames(2)
	_assert_buttons_inside(popup, area.get_global_rect(), "the buttons in the resized button area")


func test_long_labels_stay_inside_the_root_strip() -> void:
	assert_true(await start())
	var labels: PackedStringArray = PackedStringArray()
	for i: int in 3:
		labels.append(ReservedString.ui_exit_quit())
	assert_true(await UICore.open_system_popup(system_param(labels), Callable()))
	var popup: Control = system_popup()
	for button: Button in system_buttons(popup):
		button.text = "a button label much longer than a third of the width of the root".repeat(4)
	await UnitTestCore.wait_frames(3)
	_assert_buttons_along_the_bottom(popup)


func _assert_areas_from_the_root() -> void:
	var popup: Control = await _open_three_buttons()
	var root: Rect2 = popup.get_global_rect()
	_assert_inside(_body_rect(popup), root, "the body in the root")
	_assert_buttons_along_the_bottom(popup)


## The buttons in one row inside the root, along its bottom edge and below the body.
func _assert_buttons_along_the_bottom(popup: Control) -> void:
	var root: Rect2 = popup.get_global_rect()
	_assert_buttons_inside(popup, root, "the buttons in the root")
	var body: Rect2 = _body_rect(popup)
	for button: Button in system_buttons(popup):
		var rect: Rect2 = button.get_global_rect()
		assert_true(rect.position.y >= body.end.y - 1.0, "the buttons below the body")
		assert_true(root.end.y - rect.end.y < rect.size.y, "the buttons along the bottom edge")


## The buttons inside `area`, in one row, evenly spaced and without overlap.
func _assert_buttons_inside(popup: Control, area: Rect2, message: String) -> void:
	var buttons: Array[Button] = system_buttons(popup)
	assert_eq(buttons.size(), 3)
	for i: int in buttons.size():
		var rect: Rect2 = buttons[i].get_global_rect()
		_assert_inside(rect, area, message)
		assert_almost_eq(rect.position.y, buttons[0].get_global_rect().position.y, 1.0, "one row")
	var gap: float = buttons[1].get_global_rect().position.x - buttons[0].get_global_rect().end.x
	assert_true(gap > 0.0, "no overlap")
	assert_almost_eq(buttons[2].get_global_rect().position.x - buttons[1].get_global_rect().end.x, gap, 1.0,
			"even spacing")


func _assert_inside(inner: Rect2, outer: Rect2, message: String) -> void:
	assert_true(outer.grow(1.0).encloses(inner), "%s: %s in %s" % [message, inner, outer])


func _open_three_buttons() -> Control:
	var labels: PackedStringArray = PackedStringArray()
	for i: int in 3:
		labels.append(ReservedString.ui_exit_quit())
	assert_true(await UICore.open_system_popup(system_param(labels), Callable()))
	await UnitTestCore.wait_frames(3)
	return system_popup()


## The scroll area of the body and extra text.
func _body_rect(popup: Control) -> Rect2:
	var record: UICore._POPUP = UICore._shown_record_of(popup)
	return (record.system_view as UICore._SYSTEM_VIEW).scroll.get_global_rect()


func _child_rect(popup: Control, child: String) -> Rect2:
	return (popup.get_node(child) as Control).get_global_rect()


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
