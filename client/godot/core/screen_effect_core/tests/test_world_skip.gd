extends "res://core/screen_effect_core/tests/support/screen_effect_test_case.gd"
## World skip: `World` requests end `Completed` at once without the overlay, a tween or an event.

## `TweenStartedEvent`s received since `count_tweens`.
var tween_starts: int = 0


func count_tweens() -> void:
	tween_starts = 0
	assert_true(EventCore.subscribe(TweenStartedEvent, _on_tween_started))


func _on_tween_started(_event: TweenStartedEvent) -> void:
	tween_starts += 1


func test_world_requests_complete_at_once_without_overlay_tween_or_event() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	count_started()
	count_tweens()
	ScreenEffectCoreDev.set_world_skip(true)
	var skipped: Array[ScreenEffectHandle] = [
		ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, 100, 100, 100),
		ScreenEffectCore.fade(WORLD, owner, Color.RED, 0.0, 1.0, 1000),
		ScreenEffectCore.fade(WORLD, owner, Color.RED, 0.0, 1.0, 0, TweenCore.TimeBasis.GAME_TIME),
		ScreenEffectCore.play_preset(WORLD, owner, make_definition([opacity_change(1.0, 500)])),
		ScreenEffectCore.play_preset(WORLD, owner, make_definition([opacity_change(1.0, 0)])),
	]
	for handle: ScreenEffectHandle in skipped:
		assert_true(is_settled(handle))
	assert_results([COMPLETED, COMPLETED, COMPLETED, COMPLETED, COMPLETED])
	assert_no_effect(WORLD, "the World overlay stays hidden")
	for handle: ScreenEffectHandle in skipped:
		ScreenEffectCore.skip_to_end(handle)
		ScreenEffectCore.clear_handle(handle)
	assert_no_effect(WORLD, "skip_to_end of a skipped handle changes no overlay")
	await advance(300)
	assert_no_effect(WORLD, "nothing plays later")
	assert_eq(started_channels.size(), 0, "no ScreenEffectStartedEvent")
	assert_eq(tween_starts, 0, "no TweenStartedEvent")
	assert_eq(errors(), 0)


func test_world_effect_that_started_before_goes_on_and_other_channels_play() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	var playing: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, owner, Color.RED, 0.0, 1.0, 1000)
	record(playing)
	await advance(300)
	ScreenEffectCoreDev.set_world_skip(true)
	count_started()
	var before: GetOverlayStateResult = state(WORLD)
	var skipped: ScreenEffectHandle = ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, 100, 100, 100)
	assert_true(is_settled(skipped))
	assert_eq(results.size(), 1, "only the skipped flash ended")
	ScreenEffectCore.skip_to_end(skipped)
	assert_overlay(WORLD, Color.RED, before.opacity, true, "the playing fade keeps the overlay")
	var transition: ScreenEffectHandle = ScreenEffectCore.fade(TRANSITION, owner, Color.BLUE, 0.0, 1.0, 500)
	var cutscene: ScreenEffectHandle = ScreenEffectCore.flash(CUTSCENE, owner, Color.WHITE, 1.0, 100, 0, 100)
	var expected: Array[ScreenEffectCore.ScreenEffectChannel] = [TRANSITION, CUTSCENE]
	assert_eq(started_channels, expected, "the other channels publish their events")
	record(transition)
	record(cutscene)
	await advance(800)
	assert_results([COMPLETED, COMPLETED, COMPLETED, COMPLETED])
	assert_overlay(WORLD, Color.RED, 1.0, true, "the World fade played to its end")
	assert_overlay(TRANSITION, Color.BLUE, 1.0, true, "the Transition fade played")
	assert_eq(errors(), 0)


func test_input_check_still_fails_while_skipped() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	ScreenEffectCoreDev.set_world_skip(true)
	count_started()
	var failed: ScreenEffectHandle = ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.5, 100, 100, 100)
	assert_eq(errors(), 1, "one error log")
	assert_true(is_settled(failed))
	assert_results([FAILED])
	assert_no_effect(WORLD)
	assert_eq(started_channels.size(), 0)


func test_world_requests_play_after_the_skip_turns_off() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	ScreenEffectCoreDev.set_world_skip(true)
	ScreenEffectCoreDev.set_world_skip(false)
	count_started()
	count_tweens()
	var handle: ScreenEffectHandle = ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, 100, 100, 100)
	var expected: Array[ScreenEffectCore.ScreenEffectChannel] = [WORLD]
	assert_eq(started_channels, expected, "the World flash publishes its event")
	assert_eq(tween_starts, 1, "the World flash starts a tween")
	record(handle)
	await advance(150)
	assert_eq(results.size(), 0, "the flash plays")
	assert_true(state(WORLD).visible, "the overlay shows")
	await advance(300)
	assert_results([COMPLETED])


func test_release_turns_the_skip_off() -> void:
	assert_true(await start_modules())
	ScreenEffectCoreDev.set_world_skip(true)
	ScreenEffectCore.release()
	assert_false(ScreenEffectCore._world_skip)
	assert_true(ScreenEffectCore.init())
	count_started()
	ScreenEffectCore.fade(WORLD, make_owner(), Color.WHITE, 0.0, 1.0, 100)
	var expected: Array[ScreenEffectCore.ScreenEffectChannel] = [WORLD]
	assert_eq(started_channels, expected, "a World fade plays after init again")
