extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Skip: skip application to playback end, skip up to a Choice, the skip input and a playback that is not skippable.


## Staging instances under the staging parent of the view.
func staged() -> int:
	var count: int = 0
	for child: Node in view().staging_parent.get_children():
		if not child is SafeAreaIgnore:
			count += 1
	return count


func assert_skipped_to_the_end(call: PLAY, frame: int) -> void:
	assert_true(call.done)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_eq(call.finished_frame, frame, "the skip ends in the frame of the skip input")
	assert_almost_eq(hero.global_position, spot.global_position, Vector2(0.01, 0.01), "the Move is at its end")
	assert_eq(cue_steps, PackedInt64Array([7, 10]), "the left cues in order")
	assert_eq(playing(SoundCore.SoundBus.SFX).size(), 0, "no sound effect")
	assert_eq(playing(SoundCore.SoundBus.VOICE).size(), 0, "no line voice")
	assert_eq(SoundCore.get_bgm_key(), BGM_B, "the last Bgm")
	assert_eq(root().get_child_count(), 0)


func test_skip_without_a_choice_ends_in_the_same_frame_with_the_skip_applied() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_skip]")
	assert_true(line_running())
	assert_eq(staged(), 0)
	var frame: int = Engine.get_process_frames()
	var press: InputEventKey = InputEventKey.new()
	press.keycode = KEY_TAB
	press.physical_keycode = KEY_TAB
	press.pressed = true
	InputCoreDev.inject_device_input(press)
	await UnitTestCore.wait_frames(1)
	var release: InputEventKey = press.duplicate() as InputEventKey
	release.pressed = false
	InputCoreDev.inject_device_input(release)
	assert_skipped_to_the_end(call, frame)
	assert_eq(errors(), 0)


func test_the_skip_button_skips_like_cutscene_skip() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_skip]")
	var frame: int = Engine.get_process_frames()
	view().skip_button.pressed.emit()
	await UnitTestCore.wait_frames(1)
	assert_skipped_to_the_end(call, frame)
	assert_eq(errors(), 0)


func test_skip_stops_at_a_choice_and_runs_the_steps_after_it_without_skip_application() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_skip_choice]")
	await press_skip()
	assert_true(choice_running(), "the skip stops at the Choice")
	assert_eq(cue_steps, PackedInt64Array([2]))
	assert_false(CutsceneCore._skipping)
	await press_skip()
	await click(view().skip_button)
	assert_true(choice_running(), "skip input during the Choice is ignored")
	await tap(shown_choices()[0])
	assert_true(line_running(), "the Line after the Choice shows")
	assert_true(view().dialogue_box.visible)
	assert_eq(cue_steps, PackedInt64Array([2]))
	await press_advance()
	await finish(call)
	assert_eq(cue_steps, PackedInt64Array([2, 5]))
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_a_playback_that_is_not_skippable_has_no_skip() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_skip]", null, false)
	assert_false(view().skip_button.visible)
	await press_skip()
	assert_true(line_running(), "cutscene_skip does not skip")
	await press_advance()
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	assert_true(line_running(), "the Line of step 6")
	assert_false(view().skip_button.visible)
	await press_skip()
	assert_true(line_running())
	await press_advance()
	await advance(1000)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(cue_steps, PackedInt64Array([7, 10]))
	assert_eq(errors(), 0)


func test_a_playback_without_the_skippable_flag_shows_the_skip_button() -> void:
	assert_true(await start())
	var call: PLAY = await play_default("[cut_plain]")
	assert_true(view().skip_button.visible)
	await press_skip()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_eq(errors(), 0)
