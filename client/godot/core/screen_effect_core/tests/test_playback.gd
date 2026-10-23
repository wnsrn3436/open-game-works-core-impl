extends "res://core/screen_effect_core/tests/support/screen_effect_test_case.gd"
## Playback: real elapsed time, presets and the flash opacity limit.


func after_each() -> void:
	if TimeCore.is_initialized():
		TimeCore.set_paused(false)
		TimeCore.set_time_scale(1000)
	super()


func test_fade_ends_after_its_real_elapsed_duration_in_game_time_pause_and_time_scale_2000() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	TimeCore.set_paused(true)
	var paused: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, owner, Color.WHITE, 0.0, 1.0, 1000)
	record(paused)
	await advance(900)
	assert_eq(results.size(), 0, "paused: still plays before the duration")
	assert_gt(state(WORLD).opacity, 0.0, "paused: the opacity changes")
	await advance(200)
	assert_results([COMPLETED])
	assert_overlay(WORLD, Color.WHITE, 1.0, true, "paused")
	TimeCore.set_paused(false)
	TimeCore.set_time_scale(2000)
	results.clear()
	var scaled: ScreenEffectHandle = ScreenEffectCore.fade(CUTSCENE, owner, Color.WHITE, 1.0, 0.0, 1000)
	record(scaled)
	await advance(600)
	assert_eq(results.size(), 0, "time scale 2000: still plays after half the duration")
	await advance(500)
	assert_results([COMPLETED])
	assert_overlay(CUTSCENE, Color.WHITE, 0.0, true, "time scale 2000")


func test_opacity_only_preset_on_a_channel_without_effect_plays_in_black() -> void:
	assert_true(await start_modules())
	var handle: ScreenEffectHandle = ScreenEffectCore.play_preset(
		CUTSCENE, make_owner(), make_definition([opacity_change(0.6, 200)])
	)
	await advance(100)
	var playing: GetOverlayStateResult = state(CUTSCENE)
	assert_eq(playing.color, Color.BLACK)
	assert_true(playing.visible)
	assert_gt(playing.opacity, 0.0)
	record(handle)
	await advance(200)
	assert_results([COMPLETED])
	assert_overlay(CUTSCENE, Color.BLACK, 0.6, true, "after the preset")


func test_preset_with_all_times_zero_has_its_end_value_when_the_operation_returns() -> void:
	assert_true(await start_modules())
	var definition: TweenDefinition = make_definition([color_change(Color(1.0, 0.0, 0.0, 1.0), 0), opacity_change(0.4, 0)])
	var handle: ScreenEffectHandle = ScreenEffectCore.play_preset(TRANSITION, make_owner(), definition)
	assert_overlay(TRANSITION, Color.RED, 0.4, true, "when play_preset returns")
	assert_true(is_settled(handle))
	assert_results([COMPLETED])
	await advance(100)
	assert_overlay(TRANSITION, Color.RED, 0.4, true, "the end value stays")


func test_flash_opacity_limit_caps_flash_and_not_fade() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	ScreenEffectCore.set_flash_opacity_limit(0.3)
	var flash: ScreenEffectHandle = ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, 100, 100, 100)
	record(flash)
	var highest: float = 0.0
	for frame: int in 40:
		UnitTestCore.advance_clock(10, false)
		await UnitTestCore.wait_frames(1)
		var opacity: float = state(WORLD).opacity
		assert_true(opacity <= 0.3 + OPACITY_EPSILON, "flash opacity %s at frame %d" % [opacity, frame])
		highest = maxf(highest, opacity)
	assert_almost_eq(highest, 0.3, OPACITY_EPSILON, "the flash reaches the limit")
	assert_results([COMPLETED])
	assert_overlay(WORLD, Color.WHITE, 0.0, true, "an ended flash has opacity 0")
	var fade: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, owner, Color.WHITE, 0.0, 1.0, 100)
	record(fade)
	await advance(200)
	assert_results([COMPLETED, COMPLETED])
	assert_overlay(WORLD, Color.WHITE, 1.0, true, "the fade reaches opacity 1")


func test_flash_opacity_limit_applies_from_the_next_flash() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	var playing: ScreenEffectHandle = ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, 100, 100, 100)
	record(playing)
	await advance(50)
	var rising: float = state(WORLD).opacity
	assert_gt(rising, 0.3, "the flash rises above the new limit before the change")
	ScreenEffectCore.set_flash_opacity_limit(0.3)
	assert_almost_eq(state(WORLD).opacity, rising, OPACITY_EPSILON, "the change keeps the playing opacity")
	var highest: float = 0.0
	for frame: int in 30:
		UnitTestCore.advance_clock(10, false)
		await UnitTestCore.wait_frames(1)
		highest = maxf(highest, state(WORLD).opacity)
	assert_almost_eq(highest, 1.0, OPACITY_EPSILON, "the playing flash still reaches opacity 1")
	assert_results([COMPLETED])
	var next: ScreenEffectHandle = ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, 100, 100, 100)
	record(next)
	highest = 0.0
	for frame: int in 40:
		UnitTestCore.advance_clock(10, false)
		await UnitTestCore.wait_frames(1)
		var opacity: float = state(WORLD).opacity
		assert_true(opacity <= 0.3 + OPACITY_EPSILON, "next flash opacity %s at frame %d" % [opacity, frame])
		highest = maxf(highest, opacity)
	assert_almost_eq(highest, 0.3, OPACITY_EPSILON, "the next flash reaches the limit")
	assert_results([COMPLETED, COMPLETED])


func test_flash_opacity_limit_out_of_range_keeps_the_limit() -> void:
	assert_true(await start_modules())
	ScreenEffectCore.set_flash_opacity_limit(0.5)
	ScreenEffectCore.set_flash_opacity_limit(1.5)
	ScreenEffectCore.set_flash_opacity_limit(-0.1)
	ScreenEffectCore.set_flash_opacity_limit(NAN)
	assert_eq(errors(), 3)
	assert_eq(ScreenEffectCore._flash_limit, 0.5)
	ScreenEffectCore.flash(WORLD, make_owner(), Color.WHITE, 1.0, 0, 100, 0)
	await advance(50)
	assert_almost_eq(state(WORLD).opacity, 0.5, OPACITY_EPSILON)


func test_skip_to_end_of_a_flash_leaves_opacity_zero() -> void:
	assert_true(await start_modules())
	var handle: ScreenEffectHandle = ScreenEffectCore.flash(WORLD, make_owner(), Color.BLUE, 0.8, 100, 100, 100)
	await advance(150)
	assert_almost_eq(state(WORLD).opacity, 0.8, OPACITY_EPSILON, "the flash holds its peak")
	ScreenEffectCore.skip_to_end(handle)
	assert_overlay(WORLD, Color.BLUE, 0.0, true, "skipped flash")
