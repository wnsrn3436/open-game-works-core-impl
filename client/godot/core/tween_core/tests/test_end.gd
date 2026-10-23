extends "res://core/tween_core/tests/support/tween_test_case.gd"
## End reasons, end state, same property conflicts, handles, target and tag operations and destroyed targets.

const _RECEIVER := preload("res://core/tween_core/tests/support/tween_test_receiver.gd")
const _STATS := preload("res://core/tween_core/tests/support/tween_test_receiver_stats.gd")


func test_each_end_reason_calls_the_callback_once_and_wait_end_gets_the_same_reason() -> void:
	start()
	var completed: int = TweenCore.play(move(100), node_2d(), options())
	var skipped: int = TweenCore.play(move(100), node_2d(), options())
	var stopped: int = TweenCore.play(move(100), node_2d(), options())
	var destroyed_target: Node2D = node_2d()
	var destroyed: int = TweenCore.play(move(100), destroyed_target, options())
	recorder.wait(completed, 0)
	recorder.wait(skipped, 1)
	recorder.wait(stopped, 2)
	recorder.wait(destroyed, 3)
	TweenCore.skip_to_end(skipped)
	TweenCore.stop(stopped)
	destroyed_target.free()
	await advance(100)
	assert_eq(recorder.waits, {
		0: TweenCore.TweenEndReason.COMPLETED,
		1: TweenCore.TweenEndReason.SKIPPED,
		2: TweenCore.TweenEndReason.STOPPED,
		3: TweenCore.TweenEndReason.TARGET_DESTROYED,
	})
	var reasons: Array[int] = []
	for reason: int in recorder.reasons:
		reasons.append(reason)
	reasons.sort()
	assert_eq(reasons, [
		TweenCore.TweenEndReason.COMPLETED,
		TweenCore.TweenEndReason.SKIPPED,
		TweenCore.TweenEndReason.STOPPED,
		TweenCore.TweenEndReason.TARGET_DESTROYED,
	], "one callback per tween")


func test_stop_keeps_the_value_and_skip_to_end_sets_the_end_state() -> void:
	start()
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play(move(100), target)
	await advance(50)
	TweenCore.stop(handle)
	assert_almost_eq(target.position.x, 50.0, 0.001)
	await advance(100)
	assert_almost_eq(target.position.x, 50.0, 0.001)
	var colored: Node2D = node_2d()
	var red: TweenStep = step([change(TweenCore.TweenProperty.COLOR, Vector4(1, 0, 0, 1), 100)])
	var fade: TweenStep = step([change(TweenCore.TweenProperty.OPACITY, Vector4.ZERO, 100)])
	var skipped: int = TweenCore.play(definition([red, fade], 3), colored)
	await advance(50)
	TweenCore.skip_to_end(skipped)
	assert_eq(colored.modulate, Color(1, 0, 0, 0), "red with opacity 0")


func test_new_play_of_the_same_property_stops_the_earlier_tween_before_its_started_event() -> void:
	start()
	var target: Node2D = node_2d()
	var earlier: int = TweenCore.play(move(100), target, options())
	recorder.order.clear()
	var later: int = TweenCore.play(move(200), target, options())
	assert_eq(recorder.order, PackedStringArray(["end:%d" % TweenCore.TweenEndReason.STOPPED, "started"]))
	assert_false(TweenCore.is_playing(earlier))
	assert_true(TweenCore.is_playing(later))
	var scale: int = TweenCore.play(single(change(TweenCore.TweenProperty.SCALE, Vector4(2, 2, 0, 0), 100)), target)
	assert_true(TweenCore.is_playing(later), "another property does not stop it")
	var color: int = TweenCore.play(color_definition(), target, options())
	recorder.reasons.clear()
	var opacity: int = TweenCore.play(single(change(TweenCore.TweenProperty.OPACITY, Vector4.ZERO, 100)), target)
	assert_false(TweenCore.is_playing(color), "Color and Opacity are one property")
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.STOPPED]))
	assert_true(TweenCore.is_playing(opacity))
	assert_true(TweenCore.is_playing(scale))
	var other: int = TweenCore.play(move(100), node_2d())
	assert_true(TweenCore.is_playing(later), "another target does not stop it")
	assert_true(TweenCore.is_playing(other))


func test_stop_skip_and_target_and_tag_operations_called_the_callback_once_on_return() -> void:
	start()
	var target: Node2D = node_2d()
	TweenCore.stop(TweenCore.play(move(), node_2d(), options()))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.STOPPED]), "stop")
	TweenCore.skip_to_end(TweenCore.play(move(), node_2d(), options()))
	assert_eq(recorder.reasons.size(), 2, "skip_to_end")
	TweenCore.play(move(), target, options())
	assert_eq(TweenCore.stop_target(target), 1)
	assert_eq(recorder.reasons.size(), 3, "stop_target")
	TweenCore.play(move(), node_2d(), options("tagged"))
	assert_eq(TweenCore.skip_tag_to_end("tagged"), 1)
	assert_eq(recorder.reasons, PackedInt32Array([
		TweenCore.TweenEndReason.STOPPED,
		TweenCore.TweenEndReason.SKIPPED,
		TweenCore.TweenEndReason.STOPPED,
		TweenCore.TweenEndReason.SKIPPED,
	]), "skip_tag_to_end")


func test_ended_and_invalid_handles_change_nothing_and_handles_are_not_used_again() -> void:
	start()
	var kept_target: Node2D = node_2d()
	var kept: int = TweenCore.play(move(100), kept_target, options())
	var ended: int = TweenCore.play(move(100), node_2d(), options())
	TweenCore.stop(ended)
	await advance(50)
	for handle: int in [ended, 0, -1, 123456789]:
		TweenCore.stop(handle)
		TweenCore.skip_to_end(handle)
		assert_false(TweenCore.is_playing(handle))
		var reason: TweenCore.TweenEndReason = await TweenCore.wait_end(handle)
		assert_eq(reason, TweenCore.TweenEndReason.NONE)
	assert_true(TweenCore.is_playing(kept))
	assert_almost_eq(kept_target.position.x, 50.0, 0.001)
	assert_eq(recorder.reasons.size(), 1)
	var handles: Dictionary[int, bool] = {kept: true, ended: true}
	var target: Node2D = node_2d()
	for i: int in 1000:
		var handle: int = TweenCore.play(move(100), target)
		assert_false(handles.has(handle), "handle %d is new" % i)
		handles[handle] = true


func test_stop_target_and_stop_tag_end_only_their_tweens_and_count_them() -> void:
	start()
	var a: Node2D = node_2d()
	var b: Node2D = node_2d()
	TweenCore.play(move(100), a, options("x"))
	TweenCore.play(single(change(TweenCore.TweenProperty.SCALE, Vector4(2, 2, 0, 0), 100)), a, options("y"))
	var on_b: int = TweenCore.play(move(100), b, options("x"))
	assert_eq(TweenCore.stop_target(a), 2)
	assert_true(TweenCore.is_playing(on_b))
	assert_eq(TweenCore.skip_target_to_end(a), 0)
	assert_eq(TweenCore.skip_target_to_end(b), 1)
	assert_eq(b.position, Vector2(100, 0))
	var x1: int = TweenCore.play(move(100), a, options("x"))
	var x2: int = TweenCore.play(move(100), b, options("x"))
	var y: int = TweenCore.play(single(change(TweenCore.TweenProperty.SCALE, Vector4(2, 2, 0, 0), 100)), a,
			options("y"))
	assert_eq(TweenCore.stop_tag("x"), 2)
	assert_false(TweenCore.is_playing(x1))
	assert_false(TweenCore.is_playing(x2))
	assert_true(TweenCore.is_playing(y))
	assert_eq(TweenCore.skip_tag_to_end("y"), 1)
	assert_eq(a.scale, Vector2(2, 2))


func test_target_and_tag_operations_on_a_missing_object_or_empty_tag_log_and_return_zero() -> void:
	start()
	var freed: Node2D = Node2D.new()
	freed.free()
	assert_eq(TweenCore.stop_target(null), 0)
	assert_eq(TweenCore.skip_target_to_end(freed), 0)
	assert_eq(TweenCore.stop_tag(""), 0)
	assert_eq(TweenCore.skip_tag_to_end(""), 0)
	assert_eq(errors(), 4)


func test_destroyed_target_ends_with_target_destroyed_before_the_next_frame_ends() -> void:
	start()
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play(move(100), target, options())
	target.free()
	await UnitTestCore.wait_frames(2)
	assert_false(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.TARGET_DESTROYED]))


func test_destroyed_value_receiver_is_not_called_again_and_ends_with_target_destroyed_without_log() -> void:
	start()
	var receiver: _RECEIVER = _RECEIVER.new()
	var stats: _STATS = receiver.stats
	keep(receiver)
	var handle: int = TweenCore.play_value(
		TweenCore.TweenValueKind.FLOAT, Vector4.ZERO, Vector4(10, 0, 0, 0), move(100), receiver.on_float
	)
	recorder.wait(handle, 0)
	await advance(10)
	var calls: int = stats.calls
	assert_gt(calls, 0)
	receiver.free()
	await advance(10)
	assert_eq(stats.calls, calls, "the receiver is not called after its destruction")
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.TARGET_DESTROYED})
	assert_false(TweenCore.is_playing(handle))
