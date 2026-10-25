extends "res://core/tween_core/tests/support/tween_test_case.gd"
## The number of playing tweens that do not repeat forever.

## `get_finite_playing_count` read in each completion callback of `counted_options`.
var _counts_at_end: PackedInt32Array = PackedInt32Array()


func _on_counted_end(_reason: TweenCore.TweenEndReason) -> void:
	_counts_at_end.append(TweenCore.get_finite_playing_count())


func counted_options() -> TweenOptions:
	var made: TweenOptions = TweenOptions.new()
	made.callback = _on_counted_end
	return made


func test_finite_playing_count_counts_tweens_that_end_and_not_those_that_repeat_forever() -> void:
	start()
	assert_eq(TweenCore.get_finite_playing_count(), 0)
	var once: int = TweenCore.play(move(100, 1), node_2d(), counted_options())
	var value: int = TweenCore.play_value(
		TweenCore.TweenValueKind.FLOAT, Vector4.ZERO, Vector4(1, 0, 0, 0), move(200, 0), recorder.on_float
	)
	var loading: int = TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), node_2d(), counted_options())
	var failing: TweenDefinition = single(change(TweenCore.TweenProperty.POSITION, Vector4(1, 1, 0, 0), -1))
	var failed: int = TweenCore.play(failing, node_2d(), counted_options())
	assert_eq(errors(), 1, "the definition check failed")
	assert_eq(TweenCore.get_finite_playing_count(), 4, "repeat count 1, value tween, loading preset, failed check")
	var forever: int = TweenCore.play(move(100, 0), node_2d(), options())
	assert_true(TweenCore.is_playing(forever))
	assert_eq(TweenCore.get_finite_playing_count(), 4, "an infinite repeat is not counted")
	TweenCore.stop(loading)
	assert_eq(_counts_at_end, PackedInt32Array([3]), "one less when the loading preset ends")
	await frame_end()
	assert_false(TweenCore.is_playing(failed))
	assert_eq(_counts_at_end, PackedInt32Array([3, 2]), "one less in the frame the failed check tween ends")
	await advance(100)
	assert_false(TweenCore.is_playing(once))
	assert_eq(_counts_at_end, PackedInt32Array([3, 2, 1]), "one less in the frame the tween completes")
	assert_true(TweenCore.is_playing(value))
	await advance(100)
	assert_false(TweenCore.is_playing(value))
	assert_eq(TweenCore.get_finite_playing_count(), 0, "one less when the value tween completes")
	assert_true(TweenCore.is_playing(forever))
	TweenCore.stop(forever)
	assert_eq(TweenCore.get_finite_playing_count(), 0)


func test_finite_playing_count_allocates_nothing() -> void:
	start()
	TweenCore.play(move(100, 1), node_2d())
	TweenCore.play(move(100, 0), node_2d())
	LogCore.release()
	var total: int = 0
	for i: int in 100:
		total += TweenCore.get_finite_playing_count()
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	for i: int in 1000:
		total += TweenCore.get_finite_playing_count()
	# Read both before asserting: an assert allocates.
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(objects_after <= objects, "no object is made")
	assert_true(memory_after <= memory, "no memory is taken")
	assert_eq(total, 1100)
