extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Stop by scope release and by `release`, the state that playback end handling keeps and clears, the `Cutscene`
## channel, and a block lifted from outside.


## The staging instances of the view.
func staged() -> Array[Node]:
	var found: Array[Node] = []
	for child: Node in view().staging_parent.get_children():
		if not child is SafeAreaIgnore:
			found.append(child)
	return found


func overlay_opacity() -> float:
	return ScreenEffectCoreDev.get_overlay_state(ScreenEffectCore.ScreenEffectChannel.CUTSCENE).opacity


## Plays `[cut_stop]` to its Line of step 6, with the Move of step 5 at its end. Async.
func to_stop_line() -> PLAY:
	var call: PLAY = await play("[cut_stop]")
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND, "the ScreenEffect runs")
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	assert_true(line_running())
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	return call


func assert_stopped(call: PLAY, instances: Array[Node], view_node: Control) -> void:
	await UnitTestCore.wait_frames(1)
	assert_true(call.done)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.STOPPED)
	assert_false(is_instance_valid(view_node) and view_node.is_inside_tree(), "no view")
	for instance: Node in instances:
		assert_false(is_instance_valid(instance), "no staging instance")
	assert_eq(playing(SoundCore.SoundBus.VOICE).size(), 0, "no line voice")
	assert_false(block_reasons().has("cutscene"), "no block")
	assert_false(CutsceneCore._playing)


func test_releasing_the_playback_scope_stops_the_playback() -> void:
	assert_true(await start())
	var call: PLAY = await to_stop_line()
	var instances: Array[Node] = staged()
	assert_eq(instances.size(), 1)
	assert_eq(playing(SoundCore.SoundBus.VOICE), PackedStringArray([VOICE_STOP]))
	var view_node: Control = view_root()
	ResourceCore.release_scope(scope)
	await assert_stopped(call, instances, view_node)
	assert_eq(errors(), 0)


func test_release_stops_the_playback_and_its_replay_voice() -> void:
	assert_true(await start())
	var call: PLAY = await to_stop_line()
	var instances: Array[Node] = staged()
	await click(view().line_history_button)
	await UnitTestCore.wait_frames(3)
	var replayed: bool = false
	for child: Node in view().line_history_list.get_children():
		var item: CutsceneLineHistoryItem = child as CutsceneLineHistoryItem
		if item != null and item.voice_button != null and item.voice_button.visible:
			await click(item.voice_button)
			replayed = true
			break
	assert_true(replayed)
	await UnitTestCore.wait_frames(1)
	assert_eq(playing(SoundCore.SoundBus.VOICE), PackedStringArray([VOICE_STOP]), "the replay voice plays")
	var view_node: Control = view_root()
	CutsceneCore.release()
	await assert_stopped(call, instances, view_node)
	assert_eq(errors(), 0)


func test_release_during_preload_ends_with_stopped() -> void:
	assert_true(await start(true, false))
	var call: PLAY = PLAY.new()
	call.play(id("[cut_line]"), scope, null, true)
	assert_false(call.done)
	assert_true(CutsceneCore.is_playing())
	CutsceneCore.release()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.STOPPED)
	assert_false(block_reasons().has("cutscene"))
	assert_eq(errors(), 0)


func test_releasing_the_playback_scope_during_preload_ends_with_stopped() -> void:
	assert_true(await start(true, false))
	var call: PLAY = PLAY.new()
	call.play(id("[cut_line]"), scope, null, true)
	assert_false(call.done)
	assert_true(CutsceneCore.is_playing())
	ResourceCore.release_scope(scope)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.STOPPED)
	assert_false(block_reasons().has("cutscene"))
	assert_eq(errors(), 0)


func _assert_handling_keeps_positions_and_bgm(end: String) -> void:
	assert_true(await start())
	var call: PLAY = await to_stop_line()
	if loop_variants > 1:
		var loaded: Resource = ResourceCore.get_loaded(LOOP, ResourceCore.BaseKind.AUDIO_STREAM, scope)
		assert_true(loaded is ResourceVariants, "the key has variants")
	assert_eq(CutsceneCore._loop_sounds.size(), 1, "the repeating sound handle is kept")
	if CutsceneCore._loop_sounds.is_empty():
		return
	var loop_handle: int = CutsceneCore._loop_sounds[0]
	assert_true(SoundCore.is_playing(loop_handle))
	var hero_at: Vector2 = hero.global_position
	var bgm: String = SoundCore.get_bgm_key()
	assert_eq(bgm, BGM_A)
	var expected: CutsceneCore.CutsceneStatus = CutsceneCore.CutsceneStatus.STOPPED
	match end:
		"completed":
			expected = CutsceneCore.CutsceneStatus.COMPLETED
			await press_advance()
		"skipped":
			expected = CutsceneCore.CutsceneStatus.SKIPPED
			await press_skip()
		"stopped":
			CutsceneCore.release()
	await finish(call)
	assert_eq(call.status(), expected)
	assert_eq(hero.global_position, hero_at, "the actor stays")
	assert_eq(SoundCore.get_bgm_key(), bgm, "the BGM stays")
	assert_false(SoundCore.is_playing(loop_handle), "the repeating sound stopped")
	assert_eq(errors(), 0)


func test_completed_playback_end_handling_keeps_actors_and_bgm_and_stops_repeating_sounds() -> void:
	await _assert_handling_keeps_positions_and_bgm("completed")


func test_skipped_playback_end_handling_keeps_actors_and_bgm_and_stops_repeating_sounds() -> void:
	await _assert_handling_keeps_positions_and_bgm("skipped")


func test_stopped_playback_end_handling_keeps_actors_and_bgm_and_stops_repeating_sounds() -> void:
	await _assert_handling_keeps_positions_and_bgm("stopped")


func test_the_cutscene_channel_is_clear_at_the_start_at_the_effect_end_state_and_clear_after_the_end() -> void:
	assert_true(await start())
	assert_eq(overlay_opacity(), 0.0)
	var call: PLAY = await play("[cut_stop]")
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	assert_almost_eq(overlay_opacity(), 0.6, 0.001, "the end state of the preset")
	await press_advance()
	await advance(MOVE_MS)
	await finish(call)
	assert_eq(overlay_opacity(), 0.0, "after playback end")
	call = await play("[cut_stop]")
	await advance(STEP_MS)
	ResourceCore.release_scope(scope)
	await finish(call)
	assert_eq(overlay_opacity(), 0.0, "after stop")
	scope = ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, "cutscene_test_again")
	call = await play("[cut_stop]")
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	CutsceneCore.release()
	await finish(call)
	assert_eq(overlay_opacity(), 0.0, "after release")
	assert_eq(errors(), 0)


func test_a_block_lifted_by_release_all_during_the_playback_logs_no_error_at_the_end() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]")
	assert_eq(InputBlockCore.release_all(), 1)
	assert_false(block_reasons().has("cutscene"))
	await click(view().advance_button)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, "InputBlockCore"), 0)


func test_completed_playback_end_handling_stops_a_repeating_sound_with_variants() -> void:
	loop_variants = 2
	await _assert_handling_keeps_positions_and_bgm("completed")


func test_skipped_playback_end_handling_stops_a_repeating_sound_with_variants() -> void:
	loop_variants = 2
	await _assert_handling_keeps_positions_and_bgm("skipped")


func test_stopped_playback_end_handling_stops_a_repeating_sound_with_variants() -> void:
	loop_variants = 2
	await _assert_handling_keeps_positions_and_bgm("stopped")
