extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Choice: the shown choices and their order, locked choices, choice input and the picked choices of the result.


## The `text` translation key of the `cutscene_choice` row `step`, `choice` of `[cut_choice]`.
func choice_text(step: int, choice: int) -> String:
	for row: GameData.CutsceneChoiceRow in GameData.CutsceneChoiceTable.get_rows(id("[cut_choice]")):
		if row.step == step and row.choice == choice:
			return LocalizationCore.format(row.text, FormatArgs.new(), 0)
	return ""


## Plays `[cut_choice]` up to the Choice of step 2. Async.
func to_first_choice() -> PLAY:
	var call: PLAY = await play("[cut_choice]")
	await press_advance()
	assert_true(choice_running())
	return call


func test_choice_shows_the_choices_in_choice_order_and_ends_only_with_choice_input() -> void:
	assert_true(await start())
	var call: PLAY = await to_first_choice()
	var shown: Array[Button] = shown_choices()
	assert_eq(shown.size(), 3)
	assert_eq(shown[0].text, choice_text(2, 1))
	assert_eq(shown[1].text, choice_text(2, 2))
	assert_eq(shown[2].text, choice_text(2, 4))
	await tap(view().auto_advance_button)
	await tap(view().fast_forward_button)
	await press_advance()
	await tap(view().advance_button)
	await advance(AUTO_MS + FAST_FORWARD_MS)
	assert_true(choice_running(), "auto advance, fast forward and advance input do not end the Choice")
	await tap(shown[1])
	assert_true(choice_running(), "the Choice of step 3")
	assert_eq(CutsceneCore._choice_step, 3)
	await tap(shown_choices()[0])
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_choice_shows_with_a_hidden_dialogue_box() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_choice_box]")
	assert_true(choice_running())
	assert_false(view().dialogue_box.visible)
	assert_eq(shown_choices().size(), 1)
	assert_true(shown_choices()[0].is_visible_in_tree())
	await tap(shown_choices()[0])
	await finish(call)
	assert_eq(errors(), 0)


func test_locked_choices_hide_or_show_locked_and_a_passed_requirement_is_not_locked() -> void:
	assert_true(await start())
	var call: PLAY = await to_first_choice()
	var shown: Array[Button] = shown_choices()
	assert_eq(shown[0].text, choice_text(2, 1), "the locked choice with hide_locked false shows")
	assert_true(shown[0].disabled, "in the locked state")
	assert_false(shown[1].disabled)
	assert_true(shown[2].disabled)
	for button: Button in shown:
		assert_ne(button.text, choice_text(2, 3), "the locked choice with hide_locked true is hidden")
	await tap(shown[0])
	assert_true(choice_running(), "a click on a locked choice does not end the Choice")
	assert_eq(CutsceneCore._picked.size(), 0)
	CutsceneCore._stop()
	await finish(call)
	FLAGS.flag_c = true
	call = await to_first_choice()
	assert_false(shown_choices()[2].disabled, "the requirement passes")
	await tap(shown_choices()[2])
	assert_eq(CutsceneCore._choice_step, 3)
	CutsceneCore._stop()
	await finish(call)
	assert_eq(errors(), 0)


func test_more_choices_than_buttons_shows_as_many_as_the_buttons_with_an_error() -> void:
	assert_true(await start())
	FLAGS.flag_a = true
	var call: PLAY = await to_first_choice()
	assert_eq(errors(), 1)
	assert_eq(shown_choices().size(), view().choice_buttons.size())
	CutsceneCore._stop()
	await finish(call)


func test_every_choice_input_adds_its_step_and_choice_and_a_stopped_result_keeps_them() -> void:
	assert_true(await start())
	var call: PLAY = await to_first_choice()
	await tap(shown_choices()[1])
	await tap(shown_choices()[1])
	assert_true(line_running(), "Stay goes to the Line of step 4")
	ResourceCore.release_scope(scope)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.STOPPED)
	var choices: Array[CutsceneChoiceRecord] = call.result.choices
	assert_eq(choices.size(), 2)
	assert_eq([choices[0].step, choices[0].choice], [2, 2])
	assert_eq([choices[1].step, choices[1].choice], [3, 2])
	assert_eq(errors(), 0)
