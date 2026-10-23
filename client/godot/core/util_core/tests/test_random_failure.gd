extends UnitTestCase
## Failed random operations return the failure value and do not advance the sequence.

const _TWO_32: int = 4294967296


## One failing call of an operation that returns an int.
class FailedDraw:
	extends RefCounted
	var label: String = ""
	var draw: Callable = Callable()
	var expected: int = 0

	func _init(draw_label: String, failing_draw: Callable, failure_value: int) -> void:
		label = draw_label
		draw = failing_draw
		expected = failure_value


static func _failed_draws() -> Array[FailedDraw]:
	return [
		FailedDraw.new("range_int min > max", func(r: UtilRandom) -> int: return UtilCore.range_int(r, 5, 4), 5),
		FailedDraw.new(
			"range_int min below int32", func(r: UtilRandom) -> int: return UtilCore.range_int(r, -2147483649, 0), -2147483649
		),
		FailedDraw.new("range_int max above int32", func(r: UtilRandom) -> int: return UtilCore.range_int(r, 0, 2147483648), 0),
		FailedDraw.new(
			"pick_weighted negative weight", func(r: UtilRandom) -> int: return UtilCore.pick_weighted(r, PackedInt64Array([1, -1, 3])), -1
		),
		FailedDraw.new("pick_weighted sum 0", func(r: UtilRandom) -> int: return UtilCore.pick_weighted(r, PackedInt64Array([0, 0])), -1),
		FailedDraw.new("pick_weighted empty", func(r: UtilRandom) -> int: return UtilCore.pick_weighted(r, PackedInt64Array()), -1),
		FailedDraw.new(
			"pick_weighted sum over 2^32", func(r: UtilRandom) -> int: return UtilCore.pick_weighted(r, PackedInt64Array([_TWO_32, 1])), -1
		),
	]


func _assert_sequence_kept(random: UtilRandom, label: String) -> void:
	var untouched: UtilRandom = UtilCore.create_random(42)
	for i: int in 3:
		assert_eq(UtilCore.next_uint32(random), UtilCore.next_uint32(untouched), label)


func test_each_failure_returns_the_failure_value_and_keeps_the_sequence() -> void:
	for failed: FailedDraw in _failed_draws():
		var random: UtilRandom = UtilCore.create_random(42)
		var got: int = failed.draw.call(random)
		assert_eq(got, failed.expected, failed.label)
		_assert_sequence_kept(random, failed.label)


func test_shuffle_indices_with_negative_count_returns_empty_and_keeps_the_sequence() -> void:
	var random: UtilRandom = UtilCore.create_random(42)
	assert_eq(UtilCore.shuffle_indices(random, -1), PackedInt64Array())
	_assert_sequence_kept(random, "shuffle_indices count < 0")


func test_range_int_outside_int32_returns_min_and_keeps_the_sequence() -> void:
	var random: UtilRandom = UtilCore.create_random(42)
	assert_eq(UtilCore.range_int(random, 0, 2147483648), 0)
	assert_eq(UtilCore.range_int(random, -2147483649, 0), -2147483649)
	_assert_sequence_kept(random, "range_int outside int32")


func test_pick_weighted_accepts_a_sum_of_exactly_2_32() -> void:
	var random: UtilRandom = UtilCore.create_random(42)
	assert_eq(UtilCore.pick_weighted(random, PackedInt64Array([_TWO_32])), 0)
	assert_eq(UtilCore.next_uint32(random), 3244226384)


func test_shuffle_indices_of_zero_and_one_draw_nothing() -> void:
	var random: UtilRandom = UtilCore.create_random(42)
	assert_eq(UtilCore.shuffle_indices(random, 0), PackedInt64Array())
	assert_eq(UtilCore.shuffle_indices(random, 1), PackedInt64Array([0]))
	_assert_sequence_kept(random, "shuffle_indices of 0 and 1")
