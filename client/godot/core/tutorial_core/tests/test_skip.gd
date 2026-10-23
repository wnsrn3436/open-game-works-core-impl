extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## Skip: the skip button and `skip`.


func test_a_skippable_tutorial_skip_saves_the_last_step_lifts_the_block_and_starts_the_next() -> void:
	assert_true(await start())
	add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	add_anchor("tc_plain", Rect2(100, 300, 160, 60), 0, false)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]", "[tutorial_plain]"])))
	assert_true(await wait_shown())
	assert_true(has_block())
	assert_true(view().skip_button.visible)
	respond_saved(id_of("[tutorial_anchor]"), 3)
	await click(view().skip_button)
	assert_eq(saves(), PackedStringArray(["[tutorial_anchor]:3"]))
	assert_eq(events, PackedStringArray([
		"started:[tutorial_anchor]:1", "completed:[tutorial_anchor]:true", "started:[tutorial_plain]:1",
	]))
	assert_false(has_block())
	assert_true(TutorialCore.is_completed(id_of("[tutorial_anchor]")))


func test_a_tutorial_that_is_not_skippable_has_no_skip_button_and_skip_is_false() -> void:
	assert_true(await start())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_first]"])))
	assert_true(await wait_shown())
	assert_false(view().skip_button.visible)
	assert_false(TutorialCore.skip())
	assert_eq(current_text(), "[tutorial_first]:1")


func test_skip_without_a_shown_tutorial_is_false() -> void:
	assert_true(await start())
	assert_false(TutorialCore.skip())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_eq(shown_text(), "none")
	assert_false(TutorialCore.skip())
	assert_true(TutorialCore.is_running())
