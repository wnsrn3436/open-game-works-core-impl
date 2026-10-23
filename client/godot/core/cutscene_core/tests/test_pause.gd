extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Cutscene pause: the pause popup, what stops during it, its buttons, and back input after playback end.

const TYPING_MS: int = 100


func shown() -> int:
	var label: RichTextLabel = text_label()
	return label.get_total_character_count() if label.visible_characters < 0 else label.visible_characters


func resume_button() -> Button:
	return system_button(ReservedString.cutscene_pause_resume())


func skip_button() -> Button:
	return system_button(ReservedString.cutscene_pause_skip())


## Back input, then waits for the pause popup. Async.
func pause() -> void:
	await press_back()
	await wait_pause_popup()
	assert_true(CutsceneCore._paused)
	assert_not_null(resume_button(), "the pause popup is open")


func test_back_input_during_typing_pauses_typing_voice_and_steps_until_resume() -> void:
	set_setting("CutsceneCore.typingIntervalMs", TYPING_MS)
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	await tap(view().auto_advance_button)
	await advance(TYPING_MS)
	assert_eq(shown(), 1)
	await pause()
	assert_true(TimeCore.is_paused())
	assert_true(get_tree().paused, "the Voice bus voice stops with the game time pause")
	await advance(TYPING_MS * 10)
	assert_eq(shown(), 1, "typing does not count")
	assert_eq(playing(SoundCore.SoundBus.VOICE), PackedStringArray([VOICE_HELLO]), "the line voice is kept")
	assert_true(line_running(), "no next step")
	await tap(resume_button())
	await UnitTestCore.wait_frames(1)
	assert_false(CutsceneCore._paused)
	assert_false(TimeCore.is_paused())
	await advance(TYPING_MS)
	assert_eq(shown(), 2, "typing goes on")
	await pause()
	await press_back()
	await UnitTestCore.wait_frames(2)
	assert_false(CutsceneCore._paused, "the back input of the pause popup resumes")
	assert_false(TimeCore.is_paused())
	await advance(TYPING_MS)
	assert_eq(shown(), 3)
	CutsceneCore._stop()
	await finish(call)
	assert_eq(errors(), 0)


func test_a_game_time_pause_before_the_playback_stays_after_the_cutscene_pause() -> void:
	assert_true(await start())
	TimeCore.set_paused(true)
	var call: PLAY = await play("[cut_plain]")
	await pause()
	assert_false(CutsceneCore._paused_time)
	await tap(resume_button())
	await UnitTestCore.wait_frames(1)
	assert_false(CutsceneCore._paused)
	assert_true(TimeCore.is_paused())
	await press_advance()
	await finish(call)
	TimeCore.set_paused(false)
	assert_eq(errors(), 0)


func test_the_pause_ignores_advance_and_skip_and_its_skip_button_skips() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_skip]")
	await pause()
	await press_advance()
	await press_skip()
	assert_true(CutsceneCore._paused)
	assert_true(line_running(), "advance and skip are ignored")
	assert_eq(CutsceneCore._next, 1)
	var frame: int = Engine.get_process_frames()
	skip_button().pressed.emit()
	await UnitTestCore.wait_frames(2)
	assert_true(call.done)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED, "the same as the skip button")
	assert_eq(cue_steps, PackedInt64Array([7, 10]))
	assert_eq(SoundCore.get_bgm_key(), BGM_B)
	assert_false(TimeCore.is_paused())
	assert_true(call.finished_frame >= frame)
	assert_eq(errors(), 0)


func test_the_pause_popup_has_no_skip_button_when_not_skippable_or_during_a_choice() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]", null, false)
	await pause()
	assert_null(skip_button())
	await tap(resume_button())
	CutsceneCore._stop()
	await finish(call)
	call = await play("[cut_choice_box]")
	assert_true(choice_running())
	await pause()
	assert_null(skip_button())
	await tap(resume_button())
	await UnitTestCore.wait_frames(1)
	assert_true(choice_running())
	await tap(shown_choices()[0])
	await finish(call)
	assert_eq(errors(), 0)


func test_a_pause_popup_button_after_playback_end_only_closes_the_popup() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]")
	await pause()
	var resume: Button = resume_button()
	CutsceneCore._stop()
	await finish(call)
	assert_false(TimeCore.is_paused(), "playback end handling ends the game time pause of the cutscene pause")
	call = await play("[cut_plain]")
	resume.pressed.emit()
	await UnitTestCore.wait_frames(2)
	assert_null(resume_button(), "the popup closed")
	assert_true(line_running(), "the new playback goes on")
	await press_advance()
	await finish(call)
	assert_eq(errors(), 0)


func test_back_input_after_playback_end_is_not_a_cutscene_back_input() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]")
	await press_advance()
	await finish(call)
	await press_back()
	await UnitTestCore.wait_frames(2)
	assert_false(CutsceneCore._paused)
	assert_null(resume_button(), "no pause popup")
	assert_eq(errors(), 0)


## Starts `play` of `id_name` without the test resources loaded, so that the preload of playback 3 takes frames, and
## starts a cutscene pause with the back override before playback 4 attaches the view. `time_paused` calls
## `TimeCore.set_paused(true)` before the playback.
func pause_during_preload(id_name: String, time_paused: bool = false) -> PLAY:
	assert_true(await start(true, false))
	if time_paused:
		TimeCore.set_paused(true)
	var call: PLAY = PLAY.new()
	call.play(id(id_name), scope, null, true)
	assert_false(call.done)
	assert_null(view(), "the preload runs")
	CutsceneCore._on_back()
	assert_true(CutsceneCore._paused)
	return call


func test_resume_during_the_preload_runs_the_first_step_after_the_view_is_attached() -> void:
	var call: PLAY = await pause_during_preload("[cut_line]")
	CutsceneCore._on_pause_resume(CutsceneCore._pause_serial)
	assert_false(CutsceneCore._paused)
	assert_null(view(), "still before playback 4")
	assert_eq(CutsceneCore._next, 0, "no step ran")
	await wait_view(call)
	await UnitTestCore.wait_frames(1)
	assert_true(line_running(), "playback 5 runs the first step")
	assert_eq(text_label().text, "Hello")
	assert_eq(CutsceneCore._history.size(), 1)
	assert_false(TimeCore.is_paused())
	assert_null(resume_button(), "a pause that ended before the deferred popup open opens no popup")
	await press_advance()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_the_pause_skip_button_during_the_preload_skips_from_the_first_step() -> void:
	var call: PLAY = await pause_during_preload("[cut_skip]")
	CutsceneCore._on_pause_skip(CutsceneCore._pause_serial)
	await UnitTestCore.wait_frames(1)
	assert_false(CutsceneCore._paused)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_almost_eq(hero.global_position, spot.global_position, Vector2(0.01, 0.01), "the Move is at its end")
	assert_eq(cue_steps, PackedInt64Array([7, 10]))
	assert_eq(SoundCore.get_bgm_key(), BGM_B)
	assert_false(TimeCore.is_paused())
	assert_eq(errors(), 0)


func test_a_pause_from_the_preload_holds_the_first_step_until_the_pause_popup_resumes() -> void:
	var call: PLAY = await pause_during_preload("[cut_line]")
	await wait_view(call)
	await wait_pause_popup()
	assert_true(CutsceneCore._paused)
	assert_true(TimeCore.is_paused())
	assert_eq(CutsceneCore._next, 0, "the first step waits for the end of the pause")
	assert_false(view().dialogue_box.visible)
	await tap(resume_button())
	await UnitTestCore.wait_frames(1)
	assert_false(TimeCore.is_paused())
	assert_true(line_running())
	assert_eq(text_label().text, "Hello")
	await press_advance()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_a_view_check_failure_during_a_pause_from_the_preload_ends_the_game_time_pause() -> void:
	set_setting("cutsceneView", VIEW_ACTION)
	var call: PLAY = await pause_during_preload("[cut_line]")
	assert_true(TimeCore.is_paused())
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.FAILED)
	assert_eq(errors(), 1, "the view check error")
	assert_false(CutsceneCore._paused)
	assert_false(TimeCore.is_paused(), "the cutscene pause set it, so the failed start clears it")
	assert_false(root().visible)
	assert_false(block_reasons().has("cutscene"))
	assert_eq(errors(), 0)


func test_a_view_check_failure_during_a_pause_keeps_a_game_time_pause_from_before_the_playback() -> void:
	set_setting("cutsceneView", VIEW_ACTION)
	var call: PLAY = await pause_during_preload("[cut_line]", true)
	assert_false(CutsceneCore._paused_time)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.FAILED)
	assert_eq(errors(), 1, "the view check error")
	assert_false(CutsceneCore._paused)
	assert_true(TimeCore.is_paused())
	TimeCore.set_paused(false)
	assert_eq(errors(), 0)
