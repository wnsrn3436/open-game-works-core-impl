extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## Show condition: the step screen condition (`panel`, `popup`) and the step anchor condition.


func test_a_panel_step_shows_only_on_its_panel_without_popups() -> void:
	assert_true(await start())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_panel]"])))
	assert_eq(events, PackedStringArray(["started:[tutorial_panel]:1"]))
	assert_false(view_visible())
	assert_false(has_block())
	await open_panel()
	assert_true(await wait_shown())
	await open_popup(COVER)
	assert_false(view_visible())
	assert_false(has_block())
	await close_popup(COVER)
	assert_true(view_visible())
	assert_eq(current_text(), "[tutorial_panel]:1")


func test_a_popup_step_shows_only_while_its_popup_is_on_top() -> void:
	assert_true(await start())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_popup]"])))
	assert_true(await wait_shown())
	await click(view().advance_button)
	assert_eq(events, PackedStringArray(["started:[tutorial_popup]:1", "started:[tutorial_popup]:2"]))
	await frames(2)
	assert_false(view_visible())
	assert_false(has_block())
	await open_popup(POPUP)
	assert_true(await wait_shown())
	assert_true(has_block())
	await open_popup(COVER)
	assert_false(view_visible())
	assert_false(has_block())
	await close_popup(COVER)
	assert_true(view_visible())
	assert_true(has_block())


func test_a_panel_step_anchor_shown_only_outside_its_panel_does_not_show() -> void:
	assert_true(await start())
	add_anchor("tc_outside", Rect2(100, 400, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_panel]"])))
	await open_panel()
	assert_true(await wait_shown())
	await click(view().advance_button)
	assert_eq(current_text(), "[tutorial_panel]:2")
	assert_eq(UICore.get_current_panel_key(), PANEL)
	assert_true(UICore.get_anchor_rect("tc_outside").visible)
	await frames(3)
	assert_false(view_visible())
	assert_eq(shown_text(), "none")


func test_an_anchor_under_a_modal_popup_does_not_show_until_the_popup_closes() -> void:
	assert_true(await start())
	await open_panel()
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	assert_true(has_block())
	await open_popup(COVER)
	assert_false(view_visible())
	assert_false(has_block())
	await close_popup(COVER)
	assert_true(view_visible())
	assert_true(has_block())
	assert_eq(current_text(), "[tutorial_anchor]:1")


func test_a_hidden_or_replaced_anchor_pauses_and_the_new_element_is_used() -> void:
	assert_true(await start())
	var first: Button = add_anchor("tc_anchor", Rect2(100, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	assert_true(has_block())
	first.visible = false
	await frames()
	assert_false(view_visible())
	assert_false(has_block())
	first.visible = true
	await frames()
	assert_true(view_visible())
	assert_true(has_block())
	assert_eq(TutorialCore._shown.element, first)
	first.free()
	var second: Button = add_anchor("tc_anchor", Rect2(700, 300, 160, 60))
	await frames(2)
	assert_true(view_visible())
	assert_eq(TutorialCore._shown.element, second)
	respond_saved(id_of("[tutorial_anchor]"), 1)
	await click(second)
	assert_eq(clicks, PackedStringArray(["tc_anchor"]))
	assert_eq(current_text(), "[tutorial_anchor]:2")


func test_an_anchor_key_picks_its_anchor_and_a_null_key_the_top_one() -> void:
	assert_true(await start())
	var key: int = id_of("[gold]")
	var other: Button = add_anchor("tc_keyed", Rect2(100, 300, 160, 60), key + 1000)
	var keyed: Button = add_anchor("tc_keyed", Rect2(700, 300, 160, 60), key)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_keyed]"])))
	assert_true(await wait_shown())
	var rect: Rect2 = UICore.get_anchor_rect("tc_keyed", key).rect
	assert_almost_eq(center_of(view().hand_pointer), rect.get_center(), Vector2(0.01, 0.01))
	await click(other)
	assert_eq(current_text(), "[tutorial_keyed]:1")
	keyed.visible = false
	await frames(2)
	assert_true(UICore.get_anchor_rect("tc_keyed", key + 1000).visible)
	assert_false(view_visible())
	keyed.visible = true
	await frames(2)
	assert_true(view_visible())
	await click(keyed)
	assert_eq(current_text(), "[tutorial_keyed]:2")
	await frames(2)
	assert_true(view_visible())
	var top: Rect2 = UICore.get_anchor_rect("tc_keyed").rect
	assert_true(top.is_equal_approx(keyed.get_global_rect()), "the anchor added last is drawn on top")
	assert_almost_eq(center_of(view().hand_pointer), top.get_center(), Vector2(0.01, 0.01))
