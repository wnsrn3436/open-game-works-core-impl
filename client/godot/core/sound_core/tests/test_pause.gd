extends "res://core/sound_core/tests/support/sound_test_case.gd"
## Game time pause, global pause (unfocused state and pause tokens) and content positional players.

const POSITIONAL_GROUP: StringName = &"ogw_positional_sound"

var _positional: AudioStreamPlayer2D = null
var _autoplay: AudioStreamPlayer2D = null


func after_each() -> void:
	super()
	if is_instance_valid(_positional):
		_positional.queue_free()
	_positional = null
	if is_instance_valid(_autoplay):
		_autoplay.queue_free()
	_autoplay = null
	if TimeCore.is_initialized():
		TimeCore.set_paused(false)


func test_game_time_pause_stops_only_sfx_and_voice_and_they_continue_after_it() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	await load_sound(BGM_A)
	var sfx: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	var voice: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.VOICE, scope)
	var ui: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.UI, scope)
	SoundCore.play_bgm(BGM_A, scope)
	await wait_load_end(BGM_A)
	TimeCore.set_paused(true)
	await UnitTestCore.wait_frames(1)
	assert_true(player_of(sfx).stream_paused)
	assert_true(player_of(voice).stream_paused)
	assert_false(player_of(ui).stream_paused)
	assert_false(channel_of(BGM_A).player.stream_paused)
	assert_true(SoundCore.is_playing(sfx), "a paused play is playing")
	var started: int = SoundCore.play(LOOP_B, SoundCore.SoundBus.SFX, scope)
	await wait_load_end(LOOP_B)
	assert_true(player_of(started).stream_paused, "a play started in the pause starts paused")
	TimeCore.set_paused(false)
	await UnitTestCore.wait_frames(1)
	assert_false(player_of(sfx).stream_paused)
	assert_false(player_of(voice).stream_paused)
	assert_false(player_of(started).stream_paused)
	assert_true(player_of(sfx).playing)


func test_unfocused_state_and_pause_tokens_stop_every_play_and_fade_until_all_reasons_end() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	await load_sound(BGM_A)
	await load_sound(BGM_B)
	SoundCore.play_bgm(BGM_A, scope)
	await wait_load_end(BGM_A)
	await advance(CROSSFADE_MS)
	SoundCore.play_bgm(BGM_B, scope)
	await wait_load_end(BGM_B)
	var ui: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.UI, scope)
	SoundCoreDev.inject_focus_change(false)
	assert_true(player_of(ui).stream_paused)
	assert_true(channel_of(BGM_A).player.stream_paused)
	assert_true(channel_of(BGM_B).player.stream_paused)
	await advance(CROSSFADE_MS)
	assert_eq(channel_of(BGM_B).volume, 0.0, "the fade does not move")
	assert_not_null(channel_of(BGM_A))
	var first: int = SoundCore.request_pause()
	var second: int = SoundCore.request_pause()
	SoundCore.release_pause(first)
	assert_true(player_of(ui).stream_paused)
	SoundCore.release_pause(second)
	assert_true(player_of(ui).stream_paused, "unfocused state still pauses")
	var token: int = SoundCore.request_pause()
	SoundCoreDev.inject_focus_change(true)
	assert_true(player_of(ui).stream_paused, "a token still pauses")
	SoundCore.release_pause(token)
	assert_false(player_of(ui).stream_paused)
	assert_false(channel_of(BGM_B).player.stream_paused)
	await advance(CROSSFADE_MS)
	assert_eq(channel_of(BGM_B).volume, 1.0, "the fade continues")
	assert_null(channel_of(BGM_A))


func test_two_tokens_keep_the_pause_until_both_are_released() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	var handle: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	var first: int = SoundCore.request_pause()
	var second: int = SoundCore.request_pause()
	SoundCore.release_pause(first)
	assert_true(player_of(handle).stream_paused)
	SoundCore.release_pause(second)
	assert_false(player_of(handle).stream_paused)
	assert_true(player_of(handle).playing)


func test_background_events_are_an_unfocused_state() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	var handle: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.UI, scope)
	UnitTestCore.advance_clock(1000, true)
	await UnitTestCore.wait_frames(1)
	assert_false(player_of(handle).stream_paused, "entered and returned")
	SoundCore._on_background_changed(true)
	assert_true(player_of(handle).stream_paused)
	SoundCore._on_background_changed(false)
	assert_false(player_of(handle).stream_paused)


func test_release_pause_of_an_invalid_or_released_token_logs_an_error() -> void:
	assert_true(await start_modules())
	var token: int = SoundCore.request_pause()
	SoundCore.release_pause(token)
	SoundCore.release_pause(token)
	SoundCore.release_pause(SoundCore.INVALID_PAUSE_TOKEN)
	SoundCore.release_pause(12345)
	assert_eq(errors(), 3)
	assert_false(SoundCore._global_paused)


func test_content_positional_player_follows_sfx_mute_and_both_pauses_outside_play_counts() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	var stream: AudioStream = ResourceCore.get_loaded(LOOP_A, KIND, scope) as AudioStream
	_positional = AudioStreamPlayer2D.new()
	_positional.process_mode = Node.PROCESS_MODE_PAUSABLE
	_positional.bus = &"Sfx"
	_positional.stream = stream
	_positional.add_to_group(POSITIONAL_GROUP)
	add_child(_positional)
	_positional.play()
	await _wait_playback_start()
	SoundCore.set_mute(SoundCore.SoundBus.SFX, true)
	assert_true(AudioServer.is_bus_mute(bus_index(SoundCore.SoundBus.SFX)), "silent through the Sfx mute")
	SoundCore.set_mute(SoundCore.SoundBus.SFX, false)
	TimeCore.set_paused(true)
	await UnitTestCore.wait_frames(1)
	assert_true(_positional.stream_paused, "game time pause")
	TimeCore.set_paused(false)
	await UnitTestCore.wait_frames(1)
	assert_false(_positional.stream_paused)
	var token: int = SoundCore.request_pause()
	assert_true(_positional.stream_paused, "global pause")
	TimeCore.set_paused(true)
	await UnitTestCore.wait_frames(1)
	TimeCore.set_paused(false)
	await UnitTestCore.wait_frames(2)
	assert_true(_positional.stream_paused, "global pause holds after the game time pause ends")
	# The engine resumes a playing player that enters the tree while the tree is not paused.
	remove_child(_positional)
	add_child(_positional)
	assert_true(_positional.stream_paused, "added during the global pause")
	SoundCore.release_pause(token)
	assert_false(_positional.stream_paused)
	assert_true(_positional.playing)
	assert_eq(playing_count(), 0)
	assert_eq(played_buses.size(), 0)
	SoundCore.release()
	assert_true(is_instance_valid(_positional), "release does not free a content positional player")


func test_positional_players_started_during_the_global_pause_stay_silent_until_it_ends() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	var stream: AudioStream = ResourceCore.get_loaded(LOOP_A, KIND, scope) as AudioStream
	_positional = _make_positional(stream)
	add_child(_positional)
	var token: int = SoundCore.request_pause()
	_positional.play()
	_autoplay = _make_positional(stream)
	_autoplay.autoplay = true
	add_child(_autoplay)
	await _wait_playback_start()
	await get_tree().physics_frame
	# Whether a paused playback reads as `playing` differs by playback type (the browser runtime keeps a paused sample
	# playback `playing`), so silence is read from the playback position.
	for player: AudioStreamPlayer2D in [_positional, _autoplay]:
		assert_true(player.stream_paused, "the engine started the playback paused by the global pause")
	var played_position: float = _positional.get_playback_position()
	var autoplay_position: float = _autoplay.get_playback_position()
	await UnitTestCore.wait_frames(10)
	assert_eq(_positional.get_playback_position(), played_position, "play() during the global pause is silent")
	assert_eq(_autoplay.get_playback_position(), autoplay_position, "autoplay during the global pause is silent")
	SoundCore.release_pause(token)
	for player: AudioStreamPlayer2D in [_positional, _autoplay]:
		assert_false(player.stream_paused, "resumed when the global pause ends")
		assert_true(player.playing, "playing after the global pause ends")
	await _wait_playback_start()
	assert_false(_positional.stream_paused, "the sweep stops with the global pause")
	assert_false(_autoplay.stream_paused, "the sweep stops with the global pause")
	assert_eq(playing_count(), 0, "outside the play count")
	assert_eq(played_buses.size(), 0, "no SoundPlayedEvent")


func _make_positional(stream: AudioStream) -> AudioStreamPlayer2D:
	var player: AudioStreamPlayer2D = AudioStreamPlayer2D.new()
	player.process_mode = Node.PROCESS_MODE_PAUSABLE
	player.bus = &"Sfx"
	player.stream = stream
	player.add_to_group(POSITIONAL_GROUP)
	return player


## Waits until the engine has started the playback that `play()` of a positional player asked for. The engine starts
## it in the player's physics processing, and `stream_paused` only acts on a started playback. Async.
func _wait_playback_start() -> void:
	var tree: SceneTree = get_tree()
	await tree.physics_frame
	await tree.physics_frame


func test_play_in_the_frame_of_a_game_time_pause_change_follows_the_new_pause() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	await load_sound(LOOP_B)
	await load_sound(LONG)
	var before: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	TimeCore.set_paused(true)
	var started: int = SoundCore.play(LOOP_B, SoundCore.SoundBus.VOICE, scope)
	assert_true(player_of(started).stream_paused, "a play started in the frame of the pause starts paused")
	assert_true(player_of(before).stream_paused, "the Sfx play stops with it")
	var counted: int = SoundCore.play(LONG, SoundCore.SoundBus.SFX, scope)
	await advance(100)
	var slot: int = SoundCore._slot_handles.find(counted)
	assert_eq(SoundCore._slot_played_ms[slot], 0, "time in the pause is not in the length")
	TimeCore.set_paused(false)
	var resumed: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	assert_false(player_of(resumed).stream_paused, "a play started in the frame the pause ended plays")
	assert_false(player_of(started).stream_paused)
	assert_false(player_of(before).stream_paused)
