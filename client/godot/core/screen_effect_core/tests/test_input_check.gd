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
