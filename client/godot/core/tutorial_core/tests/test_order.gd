extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## `Shown` and `Paused` tutorials: which one is `Shown`, `current`, `notify_cue` and the `complete` conditions.


func test_a_paused_tutorial_waits_while_another_is_shown_and_shows_after_it() -> void:
	assert_true(await start())
	var stage_anchor: Button = add_anchor("tc_anchor", Rect2(100, 300, 160, 60))
	allow(PackedStringArray(["[tutorial_panel]", "[tutorial_anchor]"]))
	assert_true(TutorialCore.check_start())
	assert_eq(events, PackedStringArray(["started:[tutorial_panel]:1", "started:[tutorial_anchor]:1"]))
	await wait_view_settled()
	assert_true(await wait_shown())
	assert_eq(shown_text(), "[tutorial_anchor]")
	await open_panel()
	await frames(2)
	assert_eq(shown_text(), "[tutorial_anchor]", "the panel tutorial stays Paused")
	# The last `Shown` tutorial goes on with its next step though the panel tutorial can show. The panel anchor is
	# drawn on top, so it is the anchor of the step.
	respond_saved(id_of("[tutorial_anchor]"), 1)
	await click(UICore.get_anchor_rect("tc_anchor").element)
	assert_eq(current_text(), "[tutorial_anchor]:2")
	await frames(2)
	assert_eq(shown_text(), "[tutorial_anchor]")
	stage_anchor.visible = false
	var panel_anchor: Control = UICore.get_anchor_rect("tc_anchor").element
	assert_not_null(panel_anchor)
	panel_anchor.visible = false
	await frames()
	await frames()
	assert_eq(shown_text(), "[tutorial_panel]")
	assert_true(view_visible())


func test_paused_tutorials_whose_show_condition_holds_in_one_frame_show_by_order() -> void:
	assert_true(await start())
	allow(PackedStringArray(["[tutorial_panel]", "[tutorial_anchor]"]))
	assert_true(TutorialCore.check_start())
	await wait_view_settled()
	await frames(2)
	assert_eq(shown_text(), "none")
	# The panel holds a `tc_anchor` anchor: opening it meets both show conditions in one frame.
	await open_panel()
	assert_eq(shown_text(), "[tutorial_panel]")


func test_notify_cue_ends_a_paused_step_and_current_follows_shown_then_order() -> void:
	assert_true(await start())
	allow(PackedStringArray(["[tutorial_panel]", "[tutorial_cue]"]))
	assert_true(TutorialCore.check_start())
	await wait_view_settled()
	await frames(2)
	assert_eq(shown_text(), "none")
	assert_eq(current_text(), "[tutorial_panel]:1")
	assert_true(TutorialCore.notify_cue(GameData.TutorialCue.OPENED))
	assert_eq(events[events.size() - 1], "started:[tutorial_cue]:2")
	add_anchor("tc_anchor", Rect2(100, 300, 160, 60))
	assert_true(await wait_shown())
	assert_eq(shown_text(), "[tutorial_cue]")
	assert_eq(current_text(), "[tutorial_cue]:2")


func test_a_step_ends_only_by_the_condition_of_its_complete() -> void:
	assert_true(await start())
	var anchor: Button = add_anchor("tc_anchor", Rect2(100, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_cue]"])))
	assert_true(await wait_shown())
	assert_false(view().advance_button.visible)
	assert_false(TutorialCore.notify_cue(GameData.TutorialCue.CLOSED))
	await click(anchor)
	assert_eq(current_text(), "[tutorial_cue]:1")
	assert_true(TutorialCore.notify_cue(GameData.TutorialCue.OPENED))
	assert_eq(current_text(), "[tutorial_cue]:2")
	assert_false(TutorialCore.notify_cue(GameData.TutorialCue.OPENED))
	await click(anchor)
	await touch_user_state()
	assert_eq(current_text(), "[tutorial_cue]:2")
	Hooks.flag_a = true
	await touch_user_state()
	assert_eq(current_text(), "[tutorial_cue]:3")
	assert_true(TutorialCore.notify_cue(GameData.TutorialCue.CLOSED))
	assert_eq(events[events.size() - 1], "completed:[tutorial_cue]:false")


func test_cue_and_requirement_steps_end_while_waiting_for_their_anchor() -> void:
	assert_true(await start())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_cue]"])))
	assert_false(view_visible())
	assert_true(TutorialCore.notify_cue(GameData.TutorialCue.OPENED))
	assert_false(view_visible())
	assert_eq(current_text(), "[tutorial_cue]:2")
	Hooks.flag_a = true
	await touch_user_state()
	assert_eq(current_text(), "[tutorial_cue]:3")
	assert_eq(events, PackedStringArray([
		"started:[tutorial_cue]:1", "started:[tutorial_cue]:2", "started:[tutorial_cue]:3",
	]))
	assert_true(await wait_shown(), "the last step has no anchor")


func test_a_requirement_step_whose_condition_holds_ends_at_once() -> void:
	assert_true(await start())
	Hooks.flag_a = true
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_cue]"])))
	assert_true(TutorialCore.notify_cue(GameData.TutorialCue.OPENED))
	assert_eq(current_text(), "[tutorial_cue]:3")
