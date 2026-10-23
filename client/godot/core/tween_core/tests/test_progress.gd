extends "res://core/tween_core/tests/support/tween_test_case.gd"
## Step and change progress, repeat, the definition check on play, the time basis and value clamping.


func test_changes_of_a_step_start_together_and_the_next_step_waits() -> void:
	start()
	var target: Node2D = node_2d()
	var first: TweenStep = step([
		change(TweenCore.TweenProperty.POSITION, Vector4(100, 0, 0, 0), 100),
		change(TweenCore.TweenProperty.SCALE, Vector4(3, 3, 0, 0), 200),
	])
	var second: TweenStep = step([change(TweenCore.TweenProperty.ROTATION, Vector4(90, 0, 0, 0), 100)])
	TweenCore.play(definition([first, second]), target, options())
	await advance(50)
	assert_almost_eq(target.position.x, 50.0, 0.001)
	assert_almost_eq(target.scale.x, 1.5, 0.001)
	await advance(149)
	assert_eq(target.position, Vector2(100, 0))
	assert_eq(target.rotation_degrees, 0.0, "step 2 does not change before 200 ms")
	await advance(51)
	assert_almost_eq(target.rotation_degrees, 45.0, 0.001)
	await advance(50)
	assert_eq(target.position, Vector2(100, 0))
	assert_eq(target.scale, Vector2(3, 3))
	assert_eq(target.rotation_degrees, 90.0)
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))


func test_change_without_start_value_starts_from_the_value_set_during_its_delay() -> void:
	start()
	var target: Node2D = node_2d()
	TweenCore.play(single(change(TweenCore.TweenProperty.POSITION, Vector4(100, 0, 0, 0), 100, 100)), target)
	await advance(50)
	assert_eq(target.position, Vector2.ZERO, "no change during the delay")
	target.position = Vector2(40, 0)
	await advance(50)
	assert_eq(target.position, Vector2(40, 0))
	await advance(50)
	assert_almost_eq(target.position.x, 70.0, 0.001)
	await advance(50)
	assert_eq(target.position, Vector2(100, 0))


func test_repeat_count_three_completes_after_three_cycle_times_and_zero_repeats_forever() -> void:
	start()
	var handle: int = TweenCore.play(move(100, 3), node_2d(), options())
	await advance(150)
	await advance(149)
	assert_true(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons.size(), 0, "no callback before three cycle times")
	await advance(1)
	assert_false(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	var forever: int = TweenCore.play(move(100, 0), node_2d(), options())
	await advance(1000)
	await advance(5)
	assert_true(TweenCore.is_playing(forever))
	assert_eq(recorder.reasons.size(), 1)
	TweenCore.stop(forever)


func test_each_failed_definition_check_item_logs_changes_nothing_and_completes_in_the_frame() -> void:
	start()
	var failing: Dictionary[String, TweenDefinition] = failing_definitions()
	for item: String in failing:
		var target: Node2D = node_2d()
		var handle: int = TweenCore.play(failing[item], target, options())
		assert_eq(errors(), 1, item)
		assert_true(TweenCore.is_playing(handle), item)
		assert_eq(recorder.reasons.size(), 0, item)
		await frame_end()
		assert_false(TweenCore.is_playing(handle), item)
		assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]), item)
		assert_eq(target.position, Vector2.ZERO, item)
		assert_eq(target.scale, Vector2.ONE, item)
		assert_eq(target.modulate, Color.WHITE, item)
		recorder.reasons.clear()
	var node: Node3D = keep(Node3D.new()) as Node3D
	var missing_property: int = TweenCore.play(color_definition(), node, options())
	assert_eq(errors(), 1, "target without the property")
	await frame_end()
	assert_false(TweenCore.is_playing(missing_property))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))


func test_zero_duration_and_delay_change_is_playing_on_return_and_completes_before_the_frame_ends() -> void:
	start()
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play(single(change(TweenCore.TweenProperty.POSITION, Vector4(7, 8, 0, 0), 0)),
			target, options())
	assert_true(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons.size(), 0)
	await frame_end()
	assert_eq(target.position, Vector2(7, 8))
	assert_false(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))


func test_game_time_tween_holds_during_the_game_time_pause_and_real_time_tween_goes_on() -> void:
	start()
	var game: Node2D = node_2d()
	var real: Node2D = node_2d()
	TweenCore.play(move(1000), game, options("", false, null, TweenCore.TimeBasis.GAME_TIME))
	TweenCore.play(move(1000), real, options())
	await advance(100)
	assert_almost_eq(game.position.x, 10.0, 0.001)
	assert_almost_eq(real.position.x, 10.0, 0.001)
	# the frame processing runs here: the test does not wait for engine frames while the tree is paused
	TimeCore.set_paused(true)
	UnitTestCore.advance_clock(100, false)
	TweenCore._on_frame()
	assert_almost_eq(game.position.x, 10.0, 0.001, "game time tween holds")
	assert_almost_eq(real.position.x, 20.0, 0.001, "real elapsed time tween goes on")
	TimeCore.set_paused(false)
	await advance(100)
	assert_almost_eq(game.position.x, 20.0, 0.001)


func test_opacity_target_above_one_fails_and_overshooting_easing_frames_stay_in_zero_to_one() -> void:
	start()
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play(single(change(TweenCore.TweenProperty.OPACITY, Vector4(1.5, 0, 0, 0), 100)),
			target, options())
	assert_eq(errors(), 1)
	await frame_end()
	assert_false(TweenCore.is_playing(handle))
	assert_eq(target.modulate.a, 1.0)
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	var unused: Array[TweenChange] = [
		change(TweenCore.TweenProperty.OPACITY, Vector4(1, 1, 1, 0), 100),
		change(TweenCore.TweenProperty.POSITION, Vector4(10, 20, 5, 0), 100),
		change_unused_start(TweenCore.TweenProperty.OPACITY, Vector4(0, 0, 0, 1), Vector4.ZERO, 100),
		change_unused_start(TweenCore.TweenProperty.OPACITY, Vector4(1.5, 0, 0, 0), Vector4.ZERO, 100),
	]
	for one: TweenChange in unused:
		recorder.reasons.clear()
		var flat: Node2D = node_2d()
		var failed: int = TweenCore.play(single(one), flat, options())
		assert_eq(errors(), 1, "property %d" % one.property)
		await frame_end()
		assert_false(TweenCore.is_playing(failed))
		assert_eq(flat.modulate.a, 1.0)
		assert_eq(flat.position, Vector2.ZERO)
		assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	for easing: TweenCore.Easing in [TweenCore.Easing.BACK_OUT, TweenCore.Easing.ELASTIC_OUT]:
		for ends: Vector2 in [Vector2(0, 1), Vector2(1, 0)]:
			var opacity: TweenChange = change_from(
				TweenCore.TweenProperty.OPACITY, Vector4(ends.x, 0, 0, 0), Vector4(ends.y, 0, 0, 0), 100, easing
			)
			var faded: Node2D = node_2d()
			var playing: int = TweenCore.play(single(opacity), faded)
			for frame: int in 25:
				await advance(4)
				assert_between(faded.modulate.a, 0.0, 1.0, "easing %d frame %d" % [easing, frame])
			assert_false(TweenCore.is_playing(playing))
			assert_eq(faded.modulate.a, ends.y)
