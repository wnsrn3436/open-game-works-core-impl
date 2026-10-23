extends "res://core/ui_core/tests/support/ui_test_case.gd"
## `UIAnchor` and `get_anchor_rect`.


func test_visibility_and_owner() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	await UnitTestCore.wait_frames(1)
	var result: AnchorResult = UICore.get_anchor_rect("panel_button")
	assert_true(result.found and result.visible)
	var button: Button = named_button(current(), "Button")
	assert_eq(result.rect, button.get_global_rect())
	assert_eq(result.element, button)
	assert_eq(result.owner, PANEL_A)
	button.get_parent().remove_child(button)
	var holder: Control = Control.new()
	holder.visible = false
	current().add_child(holder)
	holder.add_child(button)
	result = UICore.get_anchor_rect("panel_button")
	assert_true(result.found and not result.visible, "under a hidden ancestor")
	holder.remove_child(button)
	current().add_child(button)
	holder.queue_free()
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	result = UICore.get_anchor_rect("panel_button")
	assert_true(result.found and not result.visible, "under a modal popup")
	assert_eq(result.rect, Rect2())
	assert_null(result.element)
	assert_eq(result.owner, "")
	assert_eq(UICore.get_anchor_rect("popup_first").owner, POPUP_A)
	UICore.close_all_popups()
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_false(UICore.get_anchor_rect("panel_button").visible, "under a system popup")
	UICore.close_all_popups()
	assert_true(await UICore.open_popup(POPUP_NONMODAL, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(UICore.get_anchor_rect("panel_button").visible, "only a popup without modal above")
	result = UICore.get_anchor_rect("not_there")
	assert_false(result.found or result.visible)


func test_anchor_in_a_preparing_panel_is_not_visible() -> void:
	assert_true(await start())
	var gate: GATE = LOG.add_gate(PANEL_A)
	var call: CALL = CALL.new()
	call.open_panel(PANEL_A)
	await UnitTestCore.wait_frames(3)
	var result: AnchorResult = UICore.get_anchor_rect("panel_button")
	assert_true(result.found and not result.visible)
	gate.open()
	await finish(call)


func test_top_drawn_and_scene_ui_owner() -> void:
	assert_true(await start())
	var low: Button = add_button(UICore.UILayer.SCENE_UI, "low", Vector2(100, 400))
	var anchor: UIAnchor = UIAnchor.new()
	anchor.anchor_name = "shared"
	low.add_child(anchor)
	var result: AnchorResult = UICore.get_anchor_rect("shared")
	assert_eq(result.owner, "", "an anchor on the SceneUI layer")
	var high: Button = add_button(UICore.UILayer.SCENE_UI, "high", Vector2(300, 400))
	var other: UIAnchor = UIAnchor.new()
	other.anchor_name = "shared"
	high.add_child(other)
	assert_eq(UICore.get_anchor_rect("shared").element, high, "the one drawn on top")


func test_anchor_keys() -> void:
	assert_true(await start())
	var anchors: Array[UIAnchor] = []
	var buttons: Array[Button] = []
	for i: int in 3:
		var button: Button = add_button(UICore.UILayer.SCENE_UI, "b%d" % i, Vector2(100 + 200 * i, 400))
		var anchor: UIAnchor = UIAnchor.new()
		anchor.anchor_name = "a"
		button.add_child(anchor)
		anchors.append(anchor)
		buttons.append(button)
	anchors[0].set_anchor_key(7)
	anchors[1].set_anchor_key(7)
	anchors[2].set_anchor_key(9)
	assert_eq(UICore.get_anchor_rect("a", 7).element, buttons[1], "the top one of key 7")
	assert_eq(UICore.get_anchor_rect("a", 9).element, buttons[2])
	var none: AnchorResult = UICore.get_anchor_rect("a", 8)
	assert_false(none.found or none.visible)
	assert_eq(UICore.get_anchor_rect("a").element, buttons[2], "the top one of all three")
	anchors[1].set_anchor_key(0)
	assert_eq(UICore.get_anchor_rect("a", 7).element, buttons[0])
	anchors[1].set_anchor_key(-1)
	assert_eq(errors(), 1)
	assert_eq(anchors[1].anchor_key, 0)
	UICore.get_anchor_rect("a", -1)
	assert_eq(errors(), 1)


func test_modal_covered() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	var panel_button: Button = named_button(current(), "Button")
	assert_false(UICore.is_modal_covered(panel_button))
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(UICore.is_modal_covered(panel_button))
	assert_false(UICore.is_modal_covered(named_button(popup_of(POPUP_A), "First")), "an element in the popup")
	await UICore.close_popup(popup_of(POPUP_A))
	assert_false(UICore.is_modal_covered(panel_button), "after the modal popup closed")
	assert_true(await UICore.open_popup(POPUP_NONMODAL, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_false(UICore.is_modal_covered(panel_button), "only a popup without modal above")
