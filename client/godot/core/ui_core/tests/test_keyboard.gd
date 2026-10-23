extends "res://core/ui_core/tests/support/ui_test_case.gd"
## Keyboard shift of the focused text input element.


## Sets a virtual keyboard whose top edge is at game coordinates `top`.
func _keyboard_top_at(top: float) -> void:
	var window_height: int = ResolutionCore.get_window_size().y
	var top_in_window: float = ResolutionCore.game_to_window(Vector2(0.0, top)).y
	SafeAreaCoreDev.set_virtual_keyboard(window_height - roundi(top_in_window))
	await UnitTestCore.wait_frames(2)


func _text_of(root: Node) -> LineEdit:
	return root.find_child("Text", true, false) as LineEdit


func test_popup_root_shifts_above_the_keyboard() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_TEXT, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var popup: UIPopup = popup_of(POPUP_TEXT)
	var text: LineEdit = _text_of(popup)
	var original: float = popup.position.y
	text.grab_focus()
	await UnitTestCore.wait_frames(1)
	var bottom: float = text.get_global_rect().end.y
	await _keyboard_top_at(bottom - 20.0)
	var keyboard: Rect2 = SafeAreaCore.get_keyboard_area()
	assert_true(popup.position.y < original, "the popup root moved up")
	assert_almost_eq(text.get_global_rect().end.y + KEYBOARD_GAP, keyboard.position.y, 1.0)
	SafeAreaCoreDev.clear_virtual_keyboard()
	await UnitTestCore.wait_frames(2)
	assert_almost_eq(popup.position.y, original, 0.01, "back at the original position")


func test_scene_ui_layer_shifts() -> void:
	assert_true(await start())
	var text: LineEdit = LineEdit.new()
	text.position = Vector2(200, 500)
	text.size = Vector2(300, 40)
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.SCENE_UI)
	layer.add_child(text)
	text.grab_focus()
	await UnitTestCore.wait_frames(1)
	await _keyboard_top_at(text.get_global_rect().end.y - 20.0)
	var keyboard: Rect2 = SafeAreaCore.get_keyboard_area()
	assert_true(layer.offset.y < 0.0, "the SceneUI layer moved up")
	assert_almost_eq(text.get_global_rect().end.y + layer.offset.y + KEYBOARD_GAP, keyboard.position.y, 1.0)
	SafeAreaCoreDev.clear_virtual_keyboard()
	await UnitTestCore.wait_frames(2)
	assert_eq(layer.offset.y, 0.0)


func test_shift_is_limited_by_the_safe_area_top() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_TEXT, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var popup: UIPopup = popup_of(POPUP_TEXT)
	var text: LineEdit = _text_of(popup)
	var original: float = popup.position.y
	text.grab_focus()
	await UnitTestCore.wait_frames(1)
	var rect: Rect2 = text.get_global_rect()
	var safe_top: float = SafeAreaCore.get_safe_area().position.y
	# High enough that moving the bottom edge plus the gap above it would take the top edge above the safe area.
	await _keyboard_top_at(rect.end.y + KEYBOARD_GAP - (rect.position.y - safe_top) - 20.0)
	var distance: float = original - popup.position.y
	assert_almost_eq(distance, rect.position.y - safe_top, 1.0)
	SafeAreaCoreDev.clear_virtual_keyboard()
	await UnitTestCore.wait_frames(2)
	await _keyboard_top_at(rect.end.y + KEYBOARD_GAP + 5.0)
	assert_almost_eq(popup.position.y, original, 0.01, "a keyboard below the element plus the gap does not move it")


func test_focus_move_to_another_instance() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_popup(POPUP_TEXT, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var popup: UIPopup = popup_of(POPUP_TEXT)
	var panel: UIPanel = current()
	var popup_original: float = popup.position.y
	var panel_original: float = panel.position.y
	_text_of(popup).grab_focus()
	await UnitTestCore.wait_frames(1)
	await _keyboard_top_at(_text_of(popup).get_global_rect().end.y - 20.0)
	assert_true(popup.position.y < popup_original)
	_text_of(panel).grab_focus()
	await UnitTestCore.wait_frames(2)
	assert_almost_eq(popup.position.y, popup_original, 0.01, "the old shift target is back")
	assert_true(panel.position.y < panel_original, "the new shift target moved")
