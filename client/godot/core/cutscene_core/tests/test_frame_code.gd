extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Frame code does not run steps: an input that the frame code takes runs the next steps, the skip and the choice
## input in a deferred call of the same frame.


func test_the_line_end_of_an_advance_input_runs_the_next_step_in_a_deferred_call() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_box]")
	assert_true(line_running())
	CutsceneCore._advance_input(Engine.get_process_frames())
	assert_false(line_running(), "the Line ended")
	assert_eq(CutsceneCore._next, 1, "the next step has not run yet")
	assert_true(view().dialogue_box.visible)
	await UnitTestCore.wait_frames(1)
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND, "the deferred call ran the Move")
	assert_false(view().dialogue_box.visible)
	CutsceneCore._stop()
	await finish(call)
	assert_eq(errors(), 0)


func test_a_skip_input_skips_in_a_deferred_call() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_skip]")
	var frame: int = Engine.get_process_frames()
	CutsceneCore._skip_input(frame)
	assert_true(line_running(), "nothing is skipped yet")
	assert_false(CutsceneCore._skipping)
	await UnitTestCore.wait_frames(1)
	assert_true(call.done)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_eq(call.finished_frame, frame, "the skip ends in the frame of the skip input")
	assert_eq(errors(), 0)


func test_a_choice_input_ends_the_choice_in_a_deferred_call() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_choice_box]")
	assert_true(choice_running())
	CutsceneCore._on_choice_click(CutsceneCore._play_serial, 0)
	assert_true(choice_running(), "the Choice has not ended yet")
	assert_eq(call.result, null)
	await UnitTestCore.wait_frames(1)
	assert_true(call.done)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(call.result.choices.size(), 1)
	assert_eq(errors(), 0)


func test_a_cutscene_back_input_opens_the_pause_popup_in_a_deferred_call() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]")
	CutsceneCore._on_back()
	assert_true(CutsceneCore._paused)
	assert_true(TimeCore.is_paused())
	assert_false(UICore.is_system_popup_visible(), "the popup has not opened yet")
	await wait_pause_popup()
	assert_true(UICore.is_system_popup_visible())
	await tap(system_button(ReservedString.cutscene_pause_resume()))
	await UnitTestCore.wait_frames(1)
	assert_false(CutsceneCore._paused)
	await press_advance()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)
