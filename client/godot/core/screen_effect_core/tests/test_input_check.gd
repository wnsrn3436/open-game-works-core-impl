extends "res://core/screen_effect_core/tests/support/screen_effect_test_case.gd"
## Input checks: a request out of range is `Failed`, keeps the effect that plays and sends no event.


func test_requests_out_of_range_fail_and_keep_the_playing_effect() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	var playing: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, owner, Color.RED, 0.0, 1.0, 1000)
	await advance(300)
	var before: GetOverlayStateResult = state(WORLD)
	count_started()
	var empty_step: TweenDefinition = make_definition([opacity_change(1.0, 100)])
	empty_step.steps.append(TweenStep.new())
	var failed: Array[ScreenEffectHandle] = [
		ScreenEffectCore.fade(WORLD, owner, Color(1.5, 0.0, 0.0), 0.0, 1.0, 100),
		ScreenEffectCore.fade(WORLD, owner, Color(0.0, NAN, 0.0), 0.0, 1.0, 100),
		ScreenEffectCore.fade(WORLD, owner, Color(0.0, 0.0, -0.1), 0.0, 1.0, 100),
		ScreenEffectCore.fade(WORLD, owner, Color.WHITE, -0.1, 1.0, 100),
		ScreenEffectCore.fade(WORLD, owner, Color.WHITE, 0.0, INF, 100),
		ScreenEffectCore.fade(WORLD, owner, Color.WHITE, 0.0, 1.0, -1),
		ScreenEffectCore.fade(WORLD, owner, Color.WHITE, 0.0, 1.0, MAX_DURATION_MS + 1),
		ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.1, 100, 100, 100),
		ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, -1, 100, 100),
		ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, 100, MAX_DURATION_MS + 1, 100),
		ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, 100, 100, MAX_DURATION_MS + 1),
		ScreenEffectCore.play_preset(WORLD, owner, make_definition([opacity_change(1.0, 100)], 0)),
		ScreenEffectCore.play_preset(
			WORLD, owner, make_definition([make_change(TweenCore.TweenProperty.POSITION, Vector4.ONE, 100)])
		),
		ScreenEffectCore.play_preset(WORLD, owner, empty_step),
		ScreenEffectCore.play_preset(WORLD, owner, null),
		ScreenEffectCore.fade(WORLD, null, Color.WHITE, 0.0, 1.0, 100),
	]
	assert_eq(errors(), failed.size(), "one error per failed request")
	for handle: ScreenEffectHandle in failed:
		assert_true(is_settled(handle))
	for result: ScreenEffectCore.ScreenEffectResult in results:
		assert_eq(result, FAILED)
	assert_eq(started_channels.size(), 0, "no event for a failed request")
	var after: GetOverlayStateResult = state(WORLD)
	assert_eq(after.color, before.color)
	assert_eq(after.opacity, before.opacity)
	assert_true(after.visible)
	results.clear()
	record(playing)
	assert_eq(results.size(), 0, "the playing fade still plays")
	await advance(800)
	assert_results([COMPLETED])
	assert_overlay(WORLD, Color.RED, 1.0, true, "the playing fade reached its target")


func test_each_request_that_passes_sends_one_event_of_its_channel() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	count_started()
	ScreenEffectCore.fade(WORLD, owner, Color.WHITE, 0.0, 1.0, 100)
	var first: Array[ScreenEffectCore.ScreenEffectChannel] = [WORLD]
	assert_eq(started_channels, first)
	ScreenEffectCore.flash(CUTSCENE, owner, Color.WHITE, 1.0, 100, 0, 100)
	ScreenEffectCore.play_preset(TRANSITION, owner, make_definition([opacity_change(1.0, 100)]))
	ScreenEffectCore.fade(TRANSITION, owner, Color.WHITE, 0.0, 1.0, 0)
	ScreenEffectCore.play_preset(CUTSCENE, owner, make_definition([opacity_change(1.0, 0)]))
	var expected: Array[ScreenEffectCore.ScreenEffectChannel] = [WORLD, CUTSCENE, TRANSITION, TRANSITION, CUTSCENE]
	assert_eq(started_channels, expected)
	await advance(300)
	assert_eq(started_channels, expected, "no event after the start")


func test_channel_or_time_basis_not_a_member_fails_and_keeps_the_effect_of_every_channel() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	var colors: Array[Color] = [Color.RED, Color.GREEN, Color.BLUE]
	var playing: Array[ScreenEffectHandle] = []
	for channel: ScreenEffectCore.ScreenEffectChannel in CHANNELS:
		playing.append(ScreenEffectCore.fade(channel, owner, colors[channel], 0.0, 1.0, 1000))
	await advance(300)
	var before: Array[GetOverlayStateResult] = []
	for channel: ScreenEffectCore.ScreenEffectChannel in CHANNELS:
		before.append(state(channel))
	count_started()
	var preset: TweenDefinition = make_definition([opacity_change(1.0, 100)])
	var bad_channels: Array[ScreenEffectCore.ScreenEffectChannel] = [
		-1 as ScreenEffectCore.ScreenEffectChannel, 3 as ScreenEffectCore.ScreenEffectChannel
	]
	var bad_bases: Array[TweenCore.TimeBasis] = [-1 as TweenCore.TimeBasis, 7 as TweenCore.TimeBasis]
	var game: TweenCore.TimeBasis = TweenCore.TimeBasis.GAME_TIME
	var failed: Array[ScreenEffectHandle] = []
	for channel: ScreenEffectCore.ScreenEffectChannel in bad_channels:
		failed.append(ScreenEffectCore.fade(channel, owner, Color.WHITE, 0.0, 1.0, 100))
		failed.append(ScreenEffectCore.fade(channel, owner, Color.WHITE, 0.0, 1.0, 100, game))
		failed.append(ScreenEffectCore.flash(channel, owner, Color.WHITE, 1.0, 100, 100, 100))
		failed.append(ScreenEffectCore.play_preset(channel, owner, preset))
	for channel: ScreenEffectCore.ScreenEffectChannel in CHANNELS:
		for basis: TweenCore.TimeBasis in bad_bases:
			failed.append(ScreenEffectCore.fade(channel, owner, Color.WHITE, 0.0, 1.0, 100, basis))
			failed.append(ScreenEffectCore.fade(channel, owner, Color.WHITE, 0.0, 1.0, 0, basis))
			failed.append(ScreenEffectCore.flash(channel, owner, Color.WHITE, 1.0, 100, 100, 100, basis))
			failed.append(ScreenEffectCore.play_preset(channel, owner, preset, basis))
	assert_eq(errors(), failed.size(), "one error per failed request")
	for handle: ScreenEffectHandle in failed:
		assert_true(is_settled(handle))
	for result: ScreenEffectCore.ScreenEffectResult in results:
		assert_eq(result, FAILED)
	assert_eq(started_channels.size(), 0, "no event for a failed request")
	for channel: ScreenEffectCore.ScreenEffectChannel in CHANNELS:
		var after: GetOverlayStateResult = state(channel)
		assert_eq(after.color, before[channel].color, "color of channel %d" % channel)
		assert_eq(after.opacity, before[channel].opacity, "opacity of channel %d" % channel)
		assert_true(after.visible, "channel %d is displayed" % channel)
	results.clear()
	for handle: ScreenEffectHandle in playing:
		record(handle)
	assert_eq(results.size(), 0, "the playing fades still play")
	await advance(800)
	assert_results([COMPLETED, COMPLETED, COMPLETED])
	for channel: ScreenEffectCore.ScreenEffectChannel in CHANNELS:
		assert_overlay(channel, colors[channel], 1.0, true, "the fade of channel %d reached its target" % channel)
