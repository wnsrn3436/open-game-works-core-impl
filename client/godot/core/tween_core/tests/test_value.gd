extends "res://core/tween_core/tests/support/tween_test_case.gd"
## Value tweens.


func test_each_value_kind_passes_values_between_start_and_end_and_ends_with_the_end_value() -> void:
	start()
	var duration: TweenDefinition = single(change(TweenCore.TweenProperty.POSITION, Vector4.ZERO, 100, 30))
	var float_tween: int = TweenCore.play_value(
		TweenCore.TweenValueKind.FLOAT, Vector4(10, 0, 0, 0), Vector4(20, 0, 0, 0), duration, recorder.on_float
	)
	var vector_tween: int = TweenCore.play_value(
		TweenCore.TweenValueKind.VECTOR2, Vector4(0, 0, 0, 0), Vector4(10, -10, 0, 0), duration, recorder.on_vector
	)
	var color_tween: int = TweenCore.play_value(
		TweenCore.TweenValueKind.COLOR, Vector4(0, 0, 0, 0), Vector4(1, 0.5, 0.25, 1), duration, recorder.on_color
	)
	recorder.wait(float_tween, 0)
	recorder.wait(vector_tween, 1)
	recorder.wait(color_tween, 2)
	await advance(50)
	# the receiver gets the value of each frame
	assert_gt(recorder.floats.size(), 0)
	assert_almost_eq(recorder.floats[recorder.floats.size() - 1], 15.0, 0.001, "the delay of the change is not used")
	assert_gt(recorder.vectors.size(), 0)
	assert_almost_eq(recorder.vectors[recorder.vectors.size() - 1].x, 5.0, 0.001)
	assert_almost_eq(recorder.vectors[recorder.vectors.size() - 1].y, -5.0, 0.001)
	assert_gt(recorder.colors.size(), 0)
	assert_almost_eq(recorder.colors[recorder.colors.size() - 1].g, 0.25, 0.001)
	await advance(50)
	assert_eq(recorder.floats[recorder.floats.size() - 1], 20.0)
	assert_eq(recorder.vectors[recorder.vectors.size() - 1], Vector2(10, -10))
	assert_eq(recorder.colors[recorder.colors.size() - 1], Color(1, 0.5, 0.25, 1))
	assert_eq(recorder.waits, {
		0: TweenCore.TweenEndReason.COMPLETED,
		1: TweenCore.TweenEndReason.COMPLETED,
		2: TweenCore.TweenEndReason.COMPLETED,
	})


func test_value_tween_ignores_the_game_time_pause_and_skip_calls_the_receiver_with_the_end_value() -> void:
	start()
	var handle: int = TweenCore.play_value(
		TweenCore.TweenValueKind.FLOAT, Vector4.ZERO, Vector4(8, 0, 0, 0), move(100), recorder.on_float
	)
	TimeCore.set_paused(true)
	UnitTestCore.advance_clock(50, false)
	TweenCore._on_frame()
	TimeCore.set_paused(false)
	assert_almost_eq(recorder.floats[recorder.floats.size() - 1], 4.0, 0.001)
	TweenCore.skip_to_end(handle)
	assert_eq(recorder.floats[recorder.floats.size() - 1], 8.0)


func test_invalid_value_tween_requests_return_the_invalid_handle_with_an_error_log() -> void:
	start()
	var no_change: TweenDefinition = definition([TweenStep.new()])
	var too_long: TweenDefinition = move(MAX_DURATION_MS + 1)
	var receiver: Callable = recorder.on_float
	var kind: TweenCore.TweenValueKind = TweenCore.TweenValueKind.FLOAT
	assert_eq(TweenCore.play_value(kind, Vector4.ZERO, Vector4.ONE, move(), Callable()), 0, "no receiver")
	assert_eq(TweenCore.play_value(kind, Vector4.ZERO, Vector4.ONE, null, receiver), 0, "no definition")
	assert_eq(TweenCore.play_value(kind, Vector4.ZERO, Vector4.ONE, definition([]), receiver), 0, "no step")
	assert_eq(TweenCore.play_value(kind, Vector4.ZERO, Vector4.ONE, no_change, receiver), 0, "no first change")
	assert_eq(TweenCore.play_value(kind, Vector4.ZERO, Vector4.ONE, too_long, receiver), 0, "duration")
	assert_eq(TweenCore.play_value(kind, Vector4(NAN, 0, 0, 0), Vector4.ONE, move(), receiver), 0, "start value")
	assert_eq(TweenCore.play_value(kind, Vector4.ZERO, Vector4(INF, 0, 0, 0), move(), receiver), 0, "end value")
	var other_kind: TweenCore.TweenValueKind = 99 as TweenCore.TweenValueKind
	assert_eq(TweenCore.play_value(other_kind, Vector4.ZERO, Vector4.ONE, move(), receiver), 0, "value kind")
	var other_easing: TweenDefinition = single(
		change(TweenCore.TweenProperty.POSITION, Vector4.ONE, 100, 0, 99 as TweenCore.Easing)
	)
	assert_eq(TweenCore.play_value(kind, Vector4.ZERO, Vector4.ONE, other_easing, receiver), 0, "easing")
	assert_eq(errors(), 9)
	assert_eq(recorder.floats.size(), 0)
	assert_eq(recorder.started_count, 0)


func test_zero_duration_value_tween_ends_with_the_end_value_before_the_frame_ends() -> void:
	start()
	var handle: int = TweenCore.play_value(
		TweenCore.TweenValueKind.FLOAT, Vector4.ZERO, Vector4(3, 0, 0, 0), move(0), recorder.on_float
	)
	assert_true(TweenCore.is_playing(handle))
	await frame_end()
	assert_false(TweenCore.is_playing(handle))
	assert_eq(recorder.floats, PackedFloat64Array([3.0]))
