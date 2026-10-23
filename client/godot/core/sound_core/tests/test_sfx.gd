extends "res://core/sound_core/tests/support/sound_test_case.gd"
## Sound effects: concurrency limits, replacement, `SoundPlayedEvent`, handles and sounds that are not loaded.


func test_played_event_once_per_started_play_and_none_for_rejected_stopped_or_bgm() -> void:
	set_int("SoundCore.maxConcurrent", 1)
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	await load_sound(BGM_A)
	assert_ne(SoundCore.play(LOOP_A, SoundCore.SoundBus.VOICE, scope, 5), SoundCore.INVALID_HANDLE)
	assert_eq(played_buses, PackedInt32Array([SoundCore.SoundBus.VOICE]))
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope, 1), SoundCore.INVALID_HANDLE, "lower priority")
	var handle: int = SoundCore.play(LOOP_B, SoundCore.SoundBus.UI, scope, 9)
	SoundCore.stop(handle)
	await wait_load_end(LOOP_B)
	SoundCore.play_bgm(BGM_A, scope)
	await wait_load_end(BGM_A)
	assert_eq(played_buses, PackedInt32Array([SoundCore.SoundBus.VOICE]))


func test_same_key_limit_replaces_the_lowest_priority_earliest_play_of_that_key() -> void:
	set_int("SoundCore.maxConcurrent", 3)
	set_int("SoundCore.maxConcurrentPerKey", 2)
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	await load_sound(LOOP_B)
	await load_sound(LOOP_C)
	var a1: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope, 0)
	var a2: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope, 0)
	var b1: int = SoundCore.play(LOOP_B, SoundCore.SoundBus.SFX, scope, -5)
	var a3: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope, 0)
	assert_false(SoundCore.is_playing(a1), "earliest A replaced")
	assert_true(SoundCore.is_playing(a2))
	assert_true(SoundCore.is_playing(a3))
	assert_true(SoundCore.is_playing(b1), "B is not a candidate under the same key limit")
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope, -1), SoundCore.INVALID_HANDLE)
	assert_true(SoundCore.is_playing(a2))
	assert_true(SoundCore.is_playing(a3))


func test_total_limit_replaces_the_lowest_priority_earliest_play_and_rejects_lower_priority() -> void:
	set_int("SoundCore.maxConcurrent", 3)
	set_int("SoundCore.maxConcurrentPerKey", 3)
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	await load_sound(LOOP_B)
	await load_sound(LOOP_C)
	await load_sound(BGM_A)
	SoundCore.play_bgm(BGM_A, scope)
	await wait_load_end(BGM_A)
	var a1: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope, 2)
	var b1: int = SoundCore.play(LOOP_B, SoundCore.SoundBus.UI, scope, 1)
	var b2: int = SoundCore.play(LOOP_B, SoundCore.SoundBus.UI, scope, 1)
	assert_eq(playing_count(), 3, "BGM is not counted")
	var c1: int = SoundCore.play(LOOP_C, SoundCore.SoundBus.VOICE, scope, 1)
	assert_false(SoundCore.is_playing(b1), "lowest priority, earliest")
	assert_true(SoundCore.is_playing(a1))
	assert_true(SoundCore.is_playing(b2))
	assert_true(SoundCore.is_playing(c1))
	assert_eq(SoundCore.play(LOOP_C, SoundCore.SoundBus.VOICE, scope, 0), SoundCore.INVALID_HANDLE)
	assert_eq(playing_count(), 3)
	assert_eq(SoundCore.get_bgm_key(), BGM_A)


func test_play_count_never_exceeds_max_concurrent() -> void:
	set_int("SoundCore.maxConcurrent", 4)
	set_int("SoundCore.maxConcurrentPerKey", 4)
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	await load_sound(LOOP_B)
	for index: int in 20:
		var key: String = LOOP_A if index % 2 == 0 else LOOP_B
		SoundCore.play(key, SoundCore.SoundBus.SFX, scope, index % 3)
		assert_true(playing_count() <= 4)
	assert_eq(playing_count(), 4)


func test_is_playing_while_loading_and_playing_and_false_after_end_stop_and_replacement() -> void:
	set_int("SoundCore.maxConcurrent", 1)
	assert_true(await start_modules())
	var loading: int = SoundCore.play(SHORT, SoundCore.SoundBus.SFX, scope)
	assert_true(SoundCore.is_playing(loading), "loading")
	await wait_load_end(SHORT)
	assert_true(SoundCore.is_playing(loading), "playing")
	var player: AudioStreamPlayer = player_of(loading)
	if player.playing:
		await player.finished
	assert_false(SoundCore.is_playing(loading), "ended")
	await load_sound(LOOP_A)
	var stopped: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	SoundCore.stop(stopped)
	assert_false(SoundCore.is_playing(stopped), "stopped")
	var replaced: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	var replacing: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	assert_false(SoundCore.is_playing(replaced), "replaced")
	assert_true(SoundCore.is_playing(replacing))
	assert_false(SoundCore.is_playing(SoundCore.INVALID_HANDLE))
	assert_eq(errors(), 0)


func test_stop_of_an_ended_handle_leaves_the_next_play_on_the_same_player() -> void:
	set_int("SoundCore.maxConcurrent", 1)
	assert_true(await start_modules())
	await load_sound(SHORT)
	await load_sound(LOOP_A)
	var ended: int = SoundCore.play(SHORT, SoundCore.SoundBus.SFX, scope)
	var player: AudioStreamPlayer = player_of(ended)
	if player.playing:
		await player.finished
	var next: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	assert_eq(player_of(next), player, "same player")
	SoundCore.stop(ended)
	assert_true(SoundCore.is_playing(next))
	assert_true(player.playing)


func test_play_of_a_sound_not_loaded_returns_the_handle_and_plays_after_loading() -> void:
	assert_true(await start_modules())
	var handle: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	assert_ne(handle, SoundCore.INVALID_HANDLE)
	assert_eq(playing_count(), 0, "a loading request is not playing")
	assert_eq(UnitTestCore.check_logs("warn", SoundCore._TAG), 1, "warn in a build with DEV code")
	await wait_load_end(LOOP_A)
	assert_eq(playing_keys(), PackedStringArray([LOOP_A]))
	assert_eq(played_buses, PackedInt32Array([SoundCore.SoundBus.SFX]))


func test_play_of_a_sound_not_loaded_starts_its_load_after_the_call_at_the_end_of_the_frame() -> void:
	assert_true(await start_modules())
	var handle: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	assert_false(SoundCore._pending[0].started, "no load, and no await, in the call: frame code may call play")
	assert_true(SoundCore.is_playing(handle), "a loading request is playing")
	assert_eq(UnitTestCore.check_logs("warn", SoundCore._TAG), 1, "warn in a build with DEV code")
	await UnitTestCore.wait_frames(1)
	assert_true(SoundCore._pending.is_empty() or SoundCore._pending[0].started, "the load started")
	await wait_load_end(LOOP_A)
	assert_eq(playing_keys(), PackedStringArray([LOOP_A]))


func test_stop_before_loading_ends_does_not_play() -> void:
	assert_true(await start_modules())
	var handle: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	SoundCore.stop(handle)
	assert_false(SoundCore.is_playing(handle))
	await wait_load_end(LOOP_A)
	assert_eq(playing_count(), 0)
	assert_eq(played_buses.size(), 0)


func test_scope_release_stops_its_plays_and_drops_its_loading_requests() -> void:
	assert_true(await start_modules())
	var panel: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "sound_test_panel")
	await load_sound(LOOP_A, panel)
	var playing: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, panel)
	var kept: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	var loading: int = SoundCore.play(LOOP_B, SoundCore.SoundBus.SFX, panel)
	ResourceCore.release_scope(panel)
	assert_false(SoundCore.is_playing(playing))
	assert_false(SoundCore.is_playing(loading))
	assert_true(SoundCore.is_playing(kept))
	await wait_load_end(LOOP_B)
	assert_eq(playing_keys(), PackedStringArray([LOOP_A]))


func test_play_on_master_or_bgm_or_with_a_missing_scope_is_an_invalid_handle_with_an_error() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.MASTER, scope), SoundCore.INVALID_HANDLE)
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.BGM, scope), SoundCore.INVALID_HANDLE)
	assert_eq(SoundCore.play(LOOP_A, 9 as SoundCore.SoundBus, scope), SoundCore.INVALID_HANDLE)
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, null), SoundCore.INVALID_HANDLE)
	var released: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "sound_test_released")
	ResourceCore.release_scope(released)
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, released), SoundCore.INVALID_HANDLE)
	assert_eq(errors(), 5)
	assert_eq(playing_count(), 0)


func test_handles_and_pause_tokens_are_all_different_until_release() -> void:
	set_int("SoundCore.maxConcurrent", 2)
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	var handles: Dictionary[int, bool] = {}
	var tokens: Dictionary[int, bool] = {}
	for index: int in 50:
		var handle: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
		assert_false(handles.has(handle), "handle issued twice")
		handles[handle] = true
		var token: int = SoundCore.request_pause()
		assert_false(tokens.has(token), "token issued twice")
		tokens[token] = true
		SoundCore.release_pause(token)
	assert_false(handles.has(SoundCore.INVALID_HANDLE))
	assert_false(tokens.has(SoundCore.INVALID_PAUSE_TOKEN))


func test_get_playing_reports_key_bus_and_priority_and_logs_an_error_when_the_buffer_is_full() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	await load_sound(LOOP_B)
	SoundCore.play(LOOP_A, SoundCore.SoundBus.UI, scope, 3)
	SoundCore.play(LOOP_B, SoundCore.SoundBus.VOICE, scope, -2)
	var buffer: Array[SoundPlayingRecord] = [SoundPlayingRecord.new(), SoundPlayingRecord.new()]
	assert_eq(SoundCoreDev.get_playing(buffer), 2)
	assert_eq(buffer[0].key, LOOP_A)
	assert_eq(buffer[0].bus, SoundCore.SoundBus.UI)
	assert_eq(buffer[0].priority, 3)
	assert_eq(buffer[1].key, LOOP_B)
	assert_eq(buffer[1].bus, SoundCore.SoundBus.VOICE)
	assert_eq(buffer[1].priority, -2)
	var small: Array[SoundPlayingRecord] = [SoundPlayingRecord.new()]
	assert_eq(SoundCoreDev.get_playing(small), 1)
	assert_eq(small.size(), 1)
	assert_eq(errors(), 1)


func test_play_of_a_key_whose_load_ends_with_the_fallback_does_not_play() -> void:
	assert_true(await start_modules())
	var handle: int = SoundCore.play(UNKNOWN, SoundCore.SoundBus.SFX, scope)
	assert_ne(handle, SoundCore.INVALID_HANDLE)
	assert_eq(UnitTestCore.check_logs("warn", SoundCore._TAG), 1, "warn in a build with DEV code")
	await wait_load_end(UNKNOWN)
	assert_false(SoundCore.is_playing(handle))
	assert_eq(playing_count(), 0)
	assert_eq(played_buses.size(), 0)
	assert_eq(errors(), 0)
	assert_eq(errors("ResourceCore"), 1)
