extends "res://core/sound_core/tests/support/sound_test_case.gd"
## A play that does not loop ends when the real elapsed time it spent outside pause reaches its sound length, also while
## the engine still plays it. The test clock reaches the length of `LONG` long before the engine does.

## Length of `LONG`: 20000 samples at 1000 Hz.
const LONG_MS: int = 20000


func after_each() -> void:
	super()
	if TimeCore.is_initialized():
		TimeCore.set_paused(false)


func test_a_play_ends_at_its_length_while_the_engine_still_plays_it() -> void:
	assert_true(await start_modules())
	await load_sound(LONG)
	var handle: int = SoundCore.play(LONG, SoundCore.SoundBus.SFX, scope)
	assert_ne(handle, SoundCore.INVALID_HANDLE)
	var player: AudioStreamPlayer = player_of(handle)
	await advance(LONG_MS - 1)
	assert_true(SoundCore.is_playing(handle), "1 ms before its length")
	assert_true(player.playing, "the engine plays it")
	UnitTestCore.advance_clock(1, false)
	assert_false(SoundCore.is_playing(handle), "at its length, in the same frame")
	assert_null(player_of(handle), "the handle is invalid")
	assert_false(player.playing, "its player stopped")
	assert_eq(playing_count(), 0)
	SoundCore.stop(handle)
	assert_eq(errors(), 0)


func test_an_ended_play_left_the_play_count() -> void:
	set_int("SoundCore.maxConcurrent", 1)
	assert_true(await start_modules())
	await load_sound(LONG)
	await load_sound(LOOP_A)
	var long_play: int = SoundCore.play(LONG, SoundCore.SoundBus.SFX, scope, 1)
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope, 0), SoundCore.INVALID_HANDLE,
			"the higher priority play holds the only player")
	UnitTestCore.advance_clock(LONG_MS, false)
	var next: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope, 0)
	assert_ne(next, SoundCore.INVALID_HANDLE, "the ended play left the play count")
	assert_false(SoundCore.is_playing(long_play))
	assert_true(SoundCore.is_playing(next))
	SoundCore.stop(next)


func test_time_in_a_pause_token_does_not_count_toward_the_length() -> void:
	assert_true(await start_modules())
	await load_sound(LONG)
	var handle: int = SoundCore.play(LONG, SoundCore.SoundBus.SFX, scope)
	await advance(5000)
	var token: int = SoundCore.request_pause()
	await advance(LONG_MS * 2)
	assert_true(SoundCore.is_playing(handle), "paused")
	SoundCore.release_pause(token)
	await advance(LONG_MS - 5000 - 1)
	assert_true(SoundCore.is_playing(handle), "1 ms before its length outside pause")
	await advance(1)
	assert_false(SoundCore.is_playing(handle))
	assert_eq(playing_count(), 0)


func test_time_in_a_game_time_pause_does_not_count_for_sfx_and_voice_but_counts_for_ui() -> void:
	assert_true(await start_modules())
	await load_sound(LONG)
	var sfx: int = SoundCore.play(LONG, SoundCore.SoundBus.SFX, scope)
	var voice: int = SoundCore.play(LONG, SoundCore.SoundBus.VOICE, scope)
	var ui: int = SoundCore.play(LONG, SoundCore.SoundBus.UI, scope)
	await advance(5000)
	TimeCore.set_paused(true)
	await UnitTestCore.wait_frames(1)
	await advance(LONG_MS - 5000)
	assert_true(SoundCore.is_playing(sfx), "a paused sfx play")
	assert_true(SoundCore.is_playing(voice), "a paused voice play")
	assert_false(SoundCore.is_playing(ui), "Ui does not pause in a game time pause")
	TimeCore.set_paused(false)
	await UnitTestCore.wait_frames(1)
	await advance(LONG_MS - 5000 - 1)
	assert_true(SoundCore.is_playing(sfx))
	assert_true(SoundCore.is_playing(voice))
	await advance(1)
	assert_false(SoundCore.is_playing(sfx))
	assert_false(SoundCore.is_playing(voice))
	assert_eq(playing_count(), 0)


func test_a_loop_play_does_not_end_at_its_length() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	var handle: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	await advance(LONG_MS)
	assert_true(SoundCore.is_playing(handle))
	SoundCore.stop(handle)
	assert_false(SoundCore.is_playing(handle))
