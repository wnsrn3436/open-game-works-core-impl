extends "res://core/tween_core/tests/support/tween_test_case.gd"
## The DEV finite skip of `TweenCoreDev.set_finite_skip`.


## Waits until the load of the tween preset `key` has ended.
func load_end(key: String) -> void:
	await ResourceCore.load(key, TweenCore.get_preset_kind(), ResourceCore.get_global_scope())
	await frame_end()


func test_finite_tween_requested_during_the_skip_completes_at_its_end_state_in_the_frame_without_started_event(
) -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play(move(500, 2), target, options())
	recorder.wait(handle, 0)
	assert_true(TweenCore.is_playing(handle), "playing when the operation returns")
	assert_eq(recorder.reasons.size(), 0)
	await frame_end()
	assert_eq(target.position, Vector2(100, 0))
	assert_false(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.COMPLETED})
	assert_eq(recorder.started_count, 0)


func test_value_tween_during_the_skip_calls_the_receiver_with_the_end_value_once() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	var handle: int = TweenCore.play_value(
		TweenCore.TweenValueKind.FLOAT, Vector4(10, 0, 0, 0), Vector4(20, 0, 0, 0), move(500), recorder.on_float
	)
	recorder.wait(handle, 0)
	await frame_end()
	assert_eq(recorder.floats, PackedFloat64Array([20.0]))
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.COMPLETED})
	assert_eq(recorder.started_count, 0)


func test_forever_tween_and_tween_started_before_the_skip_play_on() -> void:
	start()
	var before: Node2D = node_2d()
	var earlier: int = TweenCore.play(move(100), before, options())
	assert_eq(recorder.started_count, 1)
	TweenCoreDev.set_finite_skip(true)
	var forever_target: Node2D = node_2d()
	var forever: int = TweenCore.play(move(500, 0), forever_target, options())
	assert_eq(recorder.started_count, 2, "a forever tween publishes TweenStartedEvent")
	await advance(50)
	assert_almost_eq(before.position.x, 50.0, 0.001, "the earlier tween keeps progressing")
	assert_true(TweenCore.is_playing(earlier))
	assert_almost_eq(forever_target.position.x, 10.0, 0.001, "the forever tween plays")
	await advance(50)
	assert_eq(before.position, Vector2(100, 0))
	assert_false(TweenCore.is_playing(earlier))
	assert_true(TweenCore.is_playing(forever))
	TweenCore.stop(forever)


func test_input_block_of_a_skipped_tween_is_lifted_when_it_ends() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	var handle: int = TweenCore.play(move(500, 2), node_2d(), options("", true))
	assert_eq(tween_blocks(), 1)
	await frame_end()
	assert_false(TweenCore.is_playing(handle))
	assert_eq(tween_blocks(), 0)


func test_tween_after_the_skip_is_turned_off_progresses_over_its_duration() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	TweenCoreDev.set_finite_skip(false)
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play(move(500, 2), target, options())
	assert_eq(recorder.started_count, 1)
	await advance(250)
	assert_almost_eq(target.position.x, 50.0, 0.001)
	assert_true(TweenCore.is_playing(handle))
	await advance(500)
	assert_true(TweenCore.is_playing(handle), "the second cycle plays")
	assert_almost_eq(target.position.x, 50.0, 0.001)
	await advance(250)
	assert_false(TweenCore.is_playing(handle))
	assert_eq(target.position, Vector2(100, 0))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))


func test_skip_of_a_loading_preset_is_decided_at_its_request() -> void:
	start()
	var scope: Scope = ResourceCore.get_global_scope()
	var before: Node2D = node_2d()
	var earlier: int = TweenCore.play_preset(MOVE, scope, before, options())
	TweenCoreDev.set_finite_skip(true)
	var during: Node2D = node_2d()
	var skipped: int = TweenCore.play_preset(MOVE, scope, during, options())
	TweenCoreDev.set_finite_skip(false)
	assert_true(TweenCore.is_playing(skipped), "playing while it loads")
	await load_end(MOVE)
	assert_eq(during.position, Vector2(100, 0))
	assert_false(TweenCore.is_playing(skipped))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	assert_eq(recorder.started_count, 1, "only the preset requested before the skip starts")
	assert_true(TweenCore.is_playing(earlier))
	await advance(50)
	assert_almost_eq(before.position.x, 50.0, 0.001)


func test_preset_requested_before_the_skip_plays_when_its_load_ends_while_the_skip_is_on() -> void:
	start()
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), target, options())
	recorder.wait(handle, 0)
	assert_eq(recorder.started_count, 0, "the preset is loading")
	TweenCoreDev.set_finite_skip(true)
	await load_end(MOVE)
	assert_eq(recorder.started_count, 1, "TweenStartedEvent is published when the playback starts")
	assert_true(TweenCore.is_playing(handle))
	await advance(50)
	assert_almost_eq(target.position.x, 50.0, 0.001)
	assert_true(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons.size(), 0)
	await advance(50)
	assert_eq(target.position, Vector2(100, 0))
	assert_false(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.COMPLETED})


func test_release_turns_the_skip_off_and_it_fails_before_init() -> void:
	start()
	TweenCoreDev.set_finite_skip(true)
	TweenCore.release()
	assert_true(TweenCore.init())
	var target: Node2D = node_2d()
	TweenCore.play(move(100), target, options())
	assert_eq(recorder.started_count, 1)
	await advance(50)
	assert_almost_eq(target.position.x, 50.0, 0.001)
	TweenCore.release()
	TweenCoreDev.set_finite_skip(true)
	assert_eq(errors(), 1)
	assert_true(TweenCore.init())
	TweenCore.play(move(100), node_2d(), options())
	assert_eq(recorder.started_count, 2, "the skip stays off")
