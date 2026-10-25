extends "res://core/sound_core/tests/support/sound_test_case.gd"
## Voice duck: the duck gain of the `Bgm` bus while a `Voice` play plays, and its release.

const DUCK_DB: float = 12.0
const ATTACK_MS: int = 100
const RELEASE_MS: int = 400
const DB_ERROR: float = 0.01


func before_each() -> void:
	super()
	set_float("SoundCore.voiceDuckDb", DUCK_DB)
	set_int("SoundCore.voiceDuckAttackMs", ATTACK_MS)
	set_int("SoundCore.voiceDuckReleaseMs", RELEASE_MS)


func after_each() -> void:
	super()
	if TimeCore.is_initialized():
		TimeCore.set_paused(false)


func test_the_bgm_duck_goes_down_while_voices_play_and_comes_back_after_the_last_one_ends() -> void:
	assert_true(await start_modules())
	await load_sound(LONG)
	await advance(10)
	assert_almost_eq(duck_db(), 0.0, DB_ERROR, "no duck before a voice")
	var first: int = SoundCore.play(LONG, SoundCore.SoundBus.VOICE, scope)
	assert_ne(first, SoundCore.INVALID_HANDLE)
	await advance(ATTACK_MS / 2)
	assert_almost_eq(duck_db(), -DUCK_DB / 2.0, DB_ERROR, "half way 50 ms after the voice starts")
	await advance(ATTACK_MS / 2)
	assert_almost_eq(duck_db(), -DUCK_DB, DB_ERROR, "all the way at 100 ms")
	await advance(ATTACK_MS * 3)
	assert_almost_eq(duck_db(), -DUCK_DB, DB_ERROR, "it stays down")
	var second: int = SoundCore.play(LONG, SoundCore.SoundBus.VOICE, scope)
	assert_ne(second, SoundCore.INVALID_HANDLE)
	await advance(50)
	SoundCore.stop(first)
	await advance(RELEASE_MS)
	assert_almost_eq(duck_db(), -DUCK_DB, DB_ERROR, "the second voice keeps it down after the first ends")
	SoundCore.stop(second)
	await advance(RELEASE_MS / 2)
	assert_almost_eq(duck_db(), -DUCK_DB / 2.0, DB_ERROR, "half way 200 ms after the last voice ends")
	await advance(RELEASE_MS / 2)
	assert_almost_eq(duck_db(), 0.0, DB_ERROR, "back at 0 dB 400 ms after the last voice ends")
	assert_eq(errors(), 0)


func test_a_voice_that_starts_during_the_release_goes_down_from_where_the_release_got() -> void:
	assert_true(await start_modules())
	await load_sound(LONG)
	var first: int = SoundCore.play(LONG, SoundCore.SoundBus.VOICE, scope)
	await advance(ATTACK_MS)
	SoundCore.stop(first)
	await advance(RELEASE_MS / 4)
	assert_almost_eq(duck_db(), -DUCK_DB * 3.0 / 4.0, DB_ERROR, "a quarter of the release")
	var second: int = SoundCore.play(LONG, SoundCore.SoundBus.VOICE, scope)
	await advance(ATTACK_MS / 4)
	assert_almost_eq(duck_db(), -DUCK_DB, DB_ERROR, "the 3 dB still to go take a quarter of the attack")
	SoundCore.stop(second)


func test_a_game_time_pause_that_stops_the_voice_starts_the_release() -> void:
	assert_true(await start_modules())
	await load_sound(LONG)
	var handle: int = SoundCore.play(LONG, SoundCore.SoundBus.VOICE, scope)
	await advance(ATTACK_MS)
	assert_almost_eq(duck_db(), -DUCK_DB, DB_ERROR)
	TimeCore.set_paused(true)
	await UnitTestCore.wait_frames(1)
	await advance(RELEASE_MS / 2)
	assert_true(SoundCore.is_playing(handle), "the voice is paused, not ended")
	assert_almost_eq(duck_db(), -DUCK_DB / 2.0, DB_ERROR, "half way 200 ms into the pause")
	await advance(RELEASE_MS / 2)
	assert_almost_eq(duck_db(), 0.0, DB_ERROR, "back at 0 dB")
	TimeCore.set_paused(false)
	await UnitTestCore.wait_frames(1)
	await advance(ATTACK_MS / 2)
	assert_almost_eq(duck_db(), -DUCK_DB / 2.0, DB_ERROR, "the continued voice ducks again")
	SoundCore.stop(handle)


func test_sfx_and_ui_plays_do_not_duck_and_a_duck_of_0_db_does_nothing() -> void:
	set_float("SoundCore.voiceDuckDb", 0.0)
	assert_true(await start_modules())
	await load_sound(LONG)
	var voice: int = SoundCore.play(LONG, SoundCore.SoundBus.VOICE, scope)
	await advance(ATTACK_MS)
	assert_almost_eq(duck_db(), 0.0, DB_ERROR, "a duck of 0 dB")
	SoundCore.stop(voice)
	SoundCore.release()
	set_float("SoundCore.voiceDuckDb", DUCK_DB)
	assert_true(SoundCore.init())
	var sfx: int = SoundCore.play(LONG, SoundCore.SoundBus.SFX, scope)
	var ui: int = SoundCore.play(LONG, SoundCore.SoundBus.UI, scope)
	await advance(ATTACK_MS)
	assert_almost_eq(duck_db(), 0.0, DB_ERROR, "Sfx and Ui plays")
	SoundCore.stop(sfx)
	SoundCore.stop(ui)


func test_release_takes_the_duck_out_at_once_and_init_starts_without_duck() -> void:
	assert_true(await start_modules())
	await load_sound(LONG)
	SoundCore.play(LONG, SoundCore.SoundBus.VOICE, scope)
	await advance(ATTACK_MS)
	assert_almost_eq(duck_db(), -DUCK_DB, DB_ERROR)
	var duck: AudioEffect = SoundCore._duck
	SoundCore.release()
	var index: int = bus_index(SoundCore.SoundBus.BGM)
	if index != -1:
		for effect: int in AudioServer.get_bus_effect_count(index):
			assert_ne(AudioServer.get_bus_effect(index, effect), duck, "the duck effect left the Bgm bus")
	assert_true(SoundCore.init())
	assert_almost_eq(duck_db(), 0.0, DB_ERROR, "no duck after init again")
