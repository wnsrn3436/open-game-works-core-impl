extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Step order, wait choice commands, Wait, Jump, Branch, choices, Cue, command failures and the dialogue box.


func test_steps_run_in_step_order_and_wait_follows_the_wait_flag() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_order]")
	assert_eq(cue_steps, PackedInt64Array([1, 3]), "step 3 runs right after the Move of step 2 starts")
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND)
	await advance(MOVE_MS - 1)
	assert_eq(cue_steps, PackedInt64Array([1, 3]), "step 5 waits for the Move of step 4")
	await advance(1)
	await UnitTestCore.wait_frames(1)
	assert_eq(cue_steps, PackedInt64Array([1, 3, 5]))
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_wait_ends_its_duration_after_the_in_progress_commands_end() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_wait]")
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_WAIT)
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	assert_true(CutsceneCore._wait_counting, "the Wait counts once the Move ended")
	await advance(199)
	assert_eq(cue_steps.size(), 0, "the Wait has not passed")
	await advance(1)
	assert_eq(cue_steps, PackedInt64Array([3]))
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_playback_end_completes_and_removes_the_view_the_block_and_the_line_history() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]")
	assert_not_null(view_root())
	assert_true(block_reasons().has("cutscene"))
	assert_eq(CutsceneCore._history.size(), 1)
	await press_advance()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(call.result.choices.size(), 0)
	assert_eq(root().get_child_count(), 0, "no cutscene view")
	assert_false(root().visible)
	assert_false(block_reasons().has("cutscene"))
	assert_eq(CutsceneCore._history.size(), 0)
	assert_false(CutsceneCore.is_playing())
	assert_eq(errors(), 0)


func test_branch_jump_and_choice_go_to_next_step() -> void:
	assert_true(await start())
	FLAGS.flag_a = true
	var call: PLAY = await play("[cut_branch]")
	assert_eq(cue_steps, PackedInt64Array([3]), "a passed Branch goes to its next_step and Jump skips step 5")
	assert_true(choice_running())
	await tap(shown_choices()[0])
	await finish(call)
	assert_eq(cue_steps, PackedInt64Array([3]), "the choice goes to step 8")
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	FLAGS.flag_a = false
	cue_steps = PackedInt64Array()
	call = await play("[cut_branch]")
	assert_eq(cue_steps, PackedInt64Array([2, 3]), "a Branch that did not pass goes to the next step")
	await tap(shown_choices()[1])
	await finish(call)
	assert_eq(cue_steps, PackedInt64Array([2, 3, 7]), "the choice goes to step 7")
	assert_eq(errors(), 0)


func test_branch_in_skip_application_goes_to_next_step_the_same_way() -> void:
	assert_true(await start())
	FLAGS.flag_a = true
	var call: PLAY = await play("[cut_skip_branch]")
	await press_skip()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_eq(cue_steps, PackedInt64Array([4]))
	FLAGS.flag_a = false
	cue_steps = PackedInt64Array()
	call = await play("[cut_skip_branch]")
	await press_skip()
	await finish(call)
	assert_eq(cue_steps, PackedInt64Array([3, 4]))
	assert_eq(errors(), 0)


func test_repeating_animate_ends_when_it_starts_even_with_wait() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_loop]")
	assert_eq(cue_steps, PackedInt64Array([2]), "the next step ran right after the start")
	assert_eq(player_of(hero).current_animation, &"idle")
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_animate_ends_when_its_animation_finishes() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_animate]")
	assert_eq(cue_steps.size(), 0)
	assert_eq(player_of(hero).current_animation, &"wave")
	player_of(hero).advance(WAVE_S)
	await UnitTestCore.wait_frames(1)
	assert_eq(cue_steps, PackedInt64Array([2]))
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_command_failures_log_an_error_each_and_the_playback_goes_on() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_fail]")
	await finish(call)
	assert_eq(errors(), 3, "unregistered actor, no Position change, no animation")
	assert_eq(cue_steps, PackedInt64Array([4]))
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)


func test_destroying_the_actor_during_a_command_ends_the_command() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_animate]")
	assert_eq(cue_steps.size(), 0)
	hero.free()
	await UnitTestCore.wait_frames(1)
	assert_eq(cue_steps, PackedInt64Array([2]))
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_camera_without_a_camera_ends_after_one_error_and_calls_no_other_camera_operation() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_camera]")
	assert_eq(cue_steps, PackedInt64Array([2]))
	await finish(call)
	assert_eq(errors(), 1)
	assert_eq(UnitTestCore.check_logs(ERROR, "CameraCore"), 0)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)


func test_every_cue_publishes_one_event_with_its_cutscene_step_and_cue() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_branch]")
	await tap(shown_choices()[1])
	await finish(call)
	var cutscene: int = id("[cut_branch]")
	assert_eq(cue_ids, PackedInt64Array([cutscene, cutscene, cutscene]))
	assert_eq(cue_steps, PackedInt64Array([2, 3, 7]))
	assert_eq(cue_values, [GameData.CutsceneCue.FIRST, GameData.CutsceneCue.SECOND, GameData.CutsceneCue.FIRST])
	assert_eq(errors(), 0)


func test_the_dialogue_box_hides_after_a_line_before_other_steps_and_shows_for_lines_and_choices() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_box]")
	var box: Control = view().dialogue_box
	assert_true(box.visible, "Line")
	await press_advance()
	assert_false(box.visible, "Move after Line")
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	assert_true(line_running())
	assert_true(box.visible, "Line after Move")
	await press_advance()
	assert_true(line_running())
	assert_true(box.visible, "Line after Line")
	await press_advance()
	assert_true(choice_running())
	assert_true(box.visible, "Choice after Line")
	await tap(shown_choices()[0])
	await finish(call)
	assert_eq(errors(), 0)


func test_a_staging_with_an_end_ends_when_its_animation_finishes_and_destroys_its_instance() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_staging]")
	var first: Node = null
	for child: Node in view().staging_parent.get_children():
		if not child is SafeAreaIgnore:
			first = child
	assert_not_null(first, "the staging parent holds the instance")
	(first.get_node("AnimationPlayer") as AnimationPlayer).advance(BURST_S)
	await UnitTestCore.wait_frames(2)
	assert_false(is_instance_valid(first), "the instance was destroyed")
	var second: Node = hero.get_node_or_null("TestStaging")
	assert_not_null(second, "the actor holds the instance")
	assert_eq(cue_steps.size(), 0)
	(second.get_node("AnimationPlayer") as AnimationPlayer).advance(BURST_S)
	await UnitTestCore.wait_frames(2)
	assert_eq(cue_steps, PackedInt64Array([3]))
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)
