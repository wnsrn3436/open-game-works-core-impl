extends "res://core/sound_core/tests/support/sound_test_case.gd"
## Pitch and volume variation of `Sfx` plays, and the end of a play at its sound length ÷ its pitch scale.

## Length of `LONG`: 20000 samples at 1000 Hz.
const LONG_MS: int = 20000
const PLAY_COUNT: int = 200
## Error of a pitch scale and a gain read back from the player, which keeps them in single precision.
const READ_ERROR: float = 1.0e-5


func test_200_sfx_plays_vary_in_pitch_and_gain_within_the_settings_and_ui_and_voice_plays_do_not() -> void:
	set_float("SoundCore.sfxPitchVariationCents", 100.0)
	set_float("SoundCore.sfxVolumeVariationDb", 2.0)
	assert_true(await start_modules())
	await load_sound(SHORT)
	var pitch_low: float = pow(2.0, -100.0 / 1200.0)
	var pitch_high: float = pow(2.0, 100.0 / 1200.0)
	var gain_low: float = pow(10.0, -2.0 / 20.0)
	var gain_high: float = pow(10.0, 2.0 / 20.0)
	var pitch_min: float = INF
	var pitch_max: float = -INF
	var gain_min: float = INF
	var gain_max: float = -INF
	for index: int in PLAY_COUNT:
		var handle: int = SoundCore.play(SHORT, SoundCore.SoundBus.SFX, scope)
		var player: AudioStreamPlayer = player_of(handle)
		assert_not_null(player, "a loaded sfx plays")
		if player == null:
			return
		pitch_min = minf(pitch_min, player.pitch_scale)
		pitch_max = maxf(pitch_max, player.pitch_scale)
		gain_min = minf(gain_min, player.volume_linear)
		gain_max = maxf(gain_max, player.volume_linear)
		SoundCore.stop(handle)
	assert_between(pitch_min, pitch_low - READ_ERROR, pitch_high + READ_ERROR, "lowest pitch scale")
	assert_between(pitch_max, pitch_low - READ_ERROR, pitch_high + READ_ERROR, "highest pitch scale")
	assert_between(gain_min, gain_low - READ_ERROR, gain_high + READ_ERROR, "lowest variation gain")
	assert_between(gain_max, gain_low - READ_ERROR, gain_high + READ_ERROR, "highest variation gain")
	assert_true(pitch_min < 1.0 and pitch_max > 1.0, "pitch scales are not all equal and go both ways")
	assert_true(gain_min < 1.0 and gain_max > 1.0, "variation gains are not all equal and go both ways")
	for bus: SoundCore.SoundBus in [SoundCore.SoundBus.UI, SoundCore.SoundBus.VOICE]:
		for index: int in 20:
			# The player an sfx play varied plays the next request.
			var sfx: int = SoundCore.play(SHORT, SoundCore.SoundBus.SFX, scope)
			SoundCore.stop(sfx)
			var handle: int = SoundCore.play(SHORT, bus, scope)
			var player: AudioStreamPlayer = player_of(handle)
			assert_not_null(player)
			if player == null:
				return
			assert_eq(player.pitch_scale, 1.0, "pitch scale of a play on bus " + str(bus))
			assert_almost_eq(player.volume_linear, 1.0, READ_ERROR, "variation gain of a play on bus " + str(bus))
			SoundCore.stop(handle)
	assert_eq(errors(), 0)


func test_with_both_settings_0_every_sfx_play_has_pitch_scale_1_and_gain_1() -> void:
	assert_true(await start_modules())
	await load_sound(SHORT)
	for index: int in PLAY_COUNT:
		var handle: int = SoundCore.play(SHORT, SoundCore.SoundBus.SFX, scope)
		var player: AudioStreamPlayer = player_of(handle)
		assert_not_null(player)
		if player == null:
			return
		assert_eq(player.pitch_scale, 1.0)
		assert_almost_eq(player.volume_linear, 1.0, READ_ERROR)
		SoundCore.stop(handle)


func test_an_sfx_play_with_a_pitch_scale_below_1_plays_until_its_length_divided_by_its_pitch_scale() -> void:
	set_float("SoundCore.sfxPitchVariationCents", 100.0)
	assert_true(await start_modules())
	await load_sound(LONG)
	var handle: int = SoundCore.INVALID_HANDLE
	var pitch: float = 1.0
	# A pitch scale below 0.99 makes the end at least 200 ms later than the sound length.
	for attempt: int in 100:
		handle = SoundCore.play(LONG, SoundCore.SoundBus.SFX, scope)
		pitch = player_of(handle).pitch_scale
		if pitch < 0.99:
			break
		SoundCore.stop(handle)
	assert_lt(pitch, 0.99, "a play with a pitch scale below 0.99 came")
	if pitch >= 0.99:
		return
	var player: AudioStreamPlayer = player_of(handle)
	var end_ms: int = ceili(float(LONG_MS) / pitch)
	UnitTestCore.advance_clock(LONG_MS, false)
	assert_true(SoundCore.is_playing(handle), "at the sound length")
	UnitTestCore.advance_clock(end_ms - 1 - LONG_MS, false)
	assert_true(SoundCore.is_playing(handle), "1 ms before the length ÷ the pitch scale")
	assert_true(player.playing, "the engine has not reported its end")
	UnitTestCore.advance_clock(1, false)
	assert_false(SoundCore.is_playing(handle), "at the length ÷ the pitch scale")
	assert_null(player_of(handle), "the handle is invalid")
	assert_eq(playing_count(), 0)
	assert_eq(errors(), 0)
