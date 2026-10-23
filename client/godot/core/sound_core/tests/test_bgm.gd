extends "res://core/sound_core/tests/support/sound_test_case.gd"
## BGM: crossfade, the same key with another scope, discarded requests, `stop_bgm`, `return_bgm` and BGM scopes.


## `play_bgm` of `key` loaded in `target` (default `scope`), until its request ended. Async.
func bgm(key: String, target: Scope = null) -> void:
	var bgm_scope: Scope = target if target != null else scope
	await load_sound(key, bgm_scope)
	SoundCore.play_bgm(key, bgm_scope)
	await wait_load_end(key)


func test_a_then_b_stops_a_after_the_crossfade_and_b_is_at_volume_1() -> void:
	assert_true(await start_modules())
	await bgm(BGM_A)
	await advance(CROSSFADE_MS)
	assert_eq(channel_of(BGM_A).volume, 1.0)
	await bgm(BGM_B)
	assert_eq(SoundCore.get_bgm_key(), BGM_B)
	assert_eq(SoundCore._previous.key, BGM_A)
	await advance(CROSSFADE_MS / 2)
	assert_not_null(channel_of(BGM_A), "A plays during the crossfade")
	assert_almost_eq(channel_of(BGM_A).volume, 0.5, 0.01)
	assert_almost_eq(channel_of(BGM_B).volume, 0.5, 0.01)
	await advance(CROSSFADE_MS / 2)
	assert_null(channel_of(BGM_A), "A stopped")
	assert_eq(channel_of(BGM_B).volume, 1.0)
	assert_true(channel_of(BGM_B).player.playing)


func test_c_during_the_a_to_b_crossfade_stops_a_at_once_and_b_after_its_fade_out() -> void:
	assert_true(await start_modules())
	await bgm(BGM_A)
	await advance(CROSSFADE_MS)
	await bgm(BGM_B)
	await advance(CROSSFADE_MS / 2)
	await bgm(BGM_C)
	assert_null(channel_of(BGM_A), "A stopped without fade")
	assert_not_null(channel_of(BGM_B), "B fades out")
	assert_true(channel_of(BGM_B).stop_at_end)
	assert_eq(SoundCore.get_bgm_key(), BGM_C)
	await advance(CROSSFADE_MS)
	assert_null(channel_of(BGM_B), "B stopped after its fade out")
	assert_eq(channel_of(BGM_C).volume, 1.0)
	assert_eq(SoundCore.get_bgm_key(), BGM_C)


func test_same_key_with_s1_then_s2_continues_and_follows_s2() -> void:
	assert_true(await start_modules())
	var s1: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "sound_test_s1")
	var s2: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.POPUP, "sound_test_s2")
	await bgm(BGM_A, s1)
	await advance(CROSSFADE_MS)
	var channel: SoundCore._BGM_CHANNEL = channel_of(BGM_A)
	var position: float = channel.player.get_playback_position()
	await bgm(BGM_A, s2)
	assert_eq(channel_of(BGM_A), channel, "same player")
	assert_false(channel.fading, "no crossfade")
	assert_eq(channel.volume, 1.0)
	assert_true(channel.player.playing)
	assert_true(channel.player.get_playback_position() >= position, "playback position continues")
	for other: SoundCore._BGM_CHANNEL in SoundCore._channels:
		if other != channel:
			assert_null(other.record)
	ResourceCore.release_scope(s1)
	assert_eq(channel_of(BGM_A), channel, "plays after S1 release")
	assert_true(channel.player.playing)
	ResourceCore.release_scope(s2)
	assert_null(channel_of(BGM_A), "stops after S2 release")
	assert_eq(SoundCore.get_bgm_key(), "")
	assert_null(SoundCore._previous, "the released current BGM does not become the previous BGM")


func test_loading_b_then_c_never_plays_b() -> void:
	assert_true(await start_modules())
	SoundCore.play_bgm(BGM_B, scope)
	await load_sound(BGM_C)
	SoundCore.play_bgm(BGM_C, scope)
	await wait_load_end(BGM_B)
	await wait_load_end(BGM_C)
	assert_null(channel_of(BGM_B))
	assert_eq(SoundCore.get_bgm_key(), BGM_C)
	assert_null(SoundCore._previous)


func test_return_bgm_after_a_and_b_makes_a_current_and_clears_previous() -> void:
	assert_true(await start_modules())
	await bgm(BGM_A)
	await advance(CROSSFADE_MS)
	await bgm(BGM_B)
	await advance(CROSSFADE_MS)
	SoundCore.return_bgm()
	await wait_load_end(BGM_A)
	assert_eq(SoundCore.get_bgm_key(), BGM_A)
	assert_null(SoundCore._previous)
	await advance(CROSSFADE_MS)
	assert_eq(channel_of(BGM_A).volume, 1.0)
	assert_null(channel_of(BGM_B))


func test_stop_bgm_then_return_bgm_plays_a_again() -> void:
	assert_true(await start_modules())
	await bgm(BGM_A)
	await advance(CROSSFADE_MS)
	SoundCore.stop_bgm()
	assert_eq(SoundCore.get_bgm_key(), "")
	assert_eq(SoundCore._previous.key, BGM_A)
	assert_true(channel_of(BGM_A).stop_at_end, "A fades out")
	await advance(CROSSFADE_MS)
	assert_null(channel_of(BGM_A))
	SoundCore.return_bgm()
	await wait_load_end(BGM_A)
	assert_eq(SoundCore.get_bgm_key(), BGM_A)
	assert_true(channel_of(BGM_A).player.playing)


func test_stop_bgm_without_current_and_return_bgm_without_previous_discard_the_pending_request() -> void:
	assert_true(await start_modules())
	SoundCore.play_bgm(BGM_A, scope)
	SoundCore.stop_bgm()
	SoundCore.play_bgm(BGM_B, scope)
	SoundCore.return_bgm()
	await wait_load_end(BGM_A)
	await wait_load_end(BGM_B)
	assert_eq(SoundCore.get_bgm_key(), "")
	assert_null(channel_of(BGM_A))
	assert_null(channel_of(BGM_B))


func test_scope_omitted_bgm_plays_after_the_scene_scope_release() -> void:
	assert_true(await start_modules())
	SoundCore.play_bgm(BGM_A)
	await wait_load_end(BGM_A)
	assert_eq(SoundCore.get_bgm_key(), BGM_A)
	ResourceCore.release_scope(scope)
	assert_not_null(channel_of(BGM_A))
	assert_true(channel_of(BGM_A).player.playing)
	assert_eq(SoundCore.get_bgm_key(), BGM_A)


func test_scope_omitted_a_b_c_keeps_only_b_and_c_and_return_plays_b() -> void:
	assert_true(await start_modules())
	SoundCore.play_bgm(BGM_A)
	await wait_load_end(BGM_A)
	await advance(CROSSFADE_MS)
	SoundCore.play_bgm(BGM_B)
	await wait_load_end(BGM_B)
	await advance(CROSSFADE_MS)
	SoundCore.play_bgm(BGM_C)
	await wait_load_end(BGM_C)
	await advance(CROSSFADE_MS)
	await UnitTestCore.wait_frames(1)
	assert_false(ResourceCore.is_loaded(BGM_A, KIND))
	assert_true(ResourceCore.is_loaded(BGM_B, KIND))
	assert_true(ResourceCore.is_loaded(BGM_C, KIND))
	SoundCore.return_bgm()
	await wait_load_end(BGM_B)
	assert_eq(SoundCore.get_bgm_key(), BGM_B)
	assert_true(channel_of(BGM_B).player.playing)


func test_scope_omitted_request_discarded_while_loading_leaves_nothing_in_the_cache() -> void:
	assert_true(await start_modules())
	SoundCore.play_bgm(BGM_D)
	start_loads()
	assert_true(SoundCore._bgm_request.started, "D is loading")
	SoundCore.play_bgm(BGM_A)
	await wait_load_end(BGM_D)
	await wait_load_end(BGM_A)
	assert_false(ResourceCore.is_loaded(BGM_D, KIND))
	assert_eq(SoundCore.get_bgm_key(), BGM_A)


func test_crossfade_ends_by_real_elapsed_time_under_game_pause_and_time_scale() -> void:
	assert_true(await start_modules())
	await bgm(BGM_A)
	await advance(CROSSFADE_MS)
	TimeCore.set_time_scale(100)
	TimeCore.set_paused(true)
	await bgm(BGM_B)
	await advance(CROSSFADE_MS)
	assert_null(channel_of(BGM_A))
	assert_eq(channel_of(BGM_B).volume, 1.0)
	TimeCore.set_paused(false)
	TimeCore.set_time_scale(1000)


func test_bgm_player_loops_a_copy_and_the_cached_stream_does_not_change() -> void:
	assert_true(await start_modules())
	await bgm(BGM_A)
	var playing: AudioStreamWAV = channel_of(BGM_A).player.stream as AudioStreamWAV
	assert_eq(playing.loop_mode, AudioStreamWAV.LOOP_FORWARD)
	assert_eq(playing.loop_begin, 0)
	var cached: AudioStreamWAV = ResourceCore.get_loaded(BGM_A, KIND, scope) as AudioStreamWAV
	assert_ne(playing, cached)
	assert_eq(cached.loop_mode, AudioStreamWAV.LOOP_DISABLED)


func test_play_bgm_with_a_released_scope_keeps_the_current_bgm() -> void:
	assert_true(await start_modules())
	await bgm(BGM_A)
	var released: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "sound_test_released")
	ResourceCore.release_scope(released)
	SoundCore.play_bgm(BGM_B, released)
	assert_eq(errors(), 1)
	assert_eq(SoundCore.get_bgm_key(), BGM_A)
	assert_not_null(channel_of(BGM_A))


func test_scope_release_in_the_frame_of_play_bgm_or_return_bgm_drops_the_request_without_an_error() -> void:
	assert_true(await start_modules())
	await bgm(BGM_A)
	var scene: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "sound_test_scene")
	SoundCore.play_bgm(BGM_C, scene)
	ResourceCore.release_scope(scene)
	await UnitTestCore.wait_frames(2)
	assert_null(SoundCore._bgm_request, "play_bgm request dropped")
	assert_eq(SoundCore.get_bgm_key(), BGM_A)
	assert_null(channel_of(BGM_C))
	var previous: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "sound_test_previous")
	await bgm(BGM_B, previous)
	await bgm(BGM_A)
	assert_eq(SoundCore._previous.key, BGM_B)
	SoundCore.return_bgm()
	ResourceCore.release_scope(previous)
	await UnitTestCore.wait_frames(2)
	assert_null(SoundCore._bgm_request, "return_bgm request dropped")
	assert_null(SoundCore._previous)
	assert_eq(SoundCore.get_bgm_key(), BGM_A)
	assert_eq(errors("ResourceCore"), 0)
	assert_eq(errors(), 0)


func test_play_bgm_of_a_key_whose_load_ends_with_the_fallback_does_not_play() -> void:
	assert_true(await start_modules())
	await bgm(BGM_A)
	await advance(CROSSFADE_MS)
	SoundCore.play_bgm(UNKNOWN_BGM, scope)
	await wait_load_end(UNKNOWN_BGM)
	assert_null(SoundCore._bgm_request)
	assert_eq(SoundCore.get_bgm_key(), BGM_A)
	assert_null(SoundCore._previous)
	assert_null(channel_of(UNKNOWN_BGM))
	assert_eq(channel_of(BGM_A).volume, 1.0)
	assert_eq(errors(), 0)
	assert_eq(errors("ResourceCore"), 1)
