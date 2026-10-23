extends UnitTestCase
## PCG32 test vectors: each row starts from a new random instance made with its seed.

const _INT64_MIN: int = -9223372036854775807 - 1


func _draw_uint32(random_seed: int, count: int) -> PackedInt64Array:
	var random: UtilRandom = UtilCore.create_random(random_seed)
	var out: PackedInt64Array = PackedInt64Array()
	for i: int in count:
		out.append(UtilCore.next_uint32(random))
	return out


func _draw_range(random_seed: int, min_value: int, max_value: int, count: int) -> PackedInt64Array:
	var random: UtilRandom = UtilCore.create_random(random_seed)
	var out: PackedInt64Array = PackedInt64Array()
	for i: int in count:
		out.append(UtilCore.range_int(random, min_value, max_value))
	return out


func test_next_uint32_seed_42() -> void:
	assert_eq(_draw_uint32(42, 6), PackedInt64Array([565663470, 3244226384, 2504567229, 903561869, 4026996297, 2722332799]))


func test_next_uint32_seed_minus_42() -> void:
	assert_eq(_draw_uint32(-42, 6), PackedInt64Array([2135434507, 1425494533, 1059454827, 1281541498, 243802185, 3332889050]))


func test_next_uint32_seed_int64_min() -> void:
	assert_eq(_draw_uint32(_INT64_MIN, 3), PackedInt64Array([1191765185, 1695953820, 3015401034]))


func test_range_int_dice() -> void:
	assert_eq(_draw_range(42, 1, 6, 10), PackedInt64Array([1, 3, 4, 6, 4, 2, 3, 3, 3, 3]))


func test_range_int_full_int32() -> void:
	assert_eq(_draw_range(42, -2147483648, 2147483647, 3), PackedInt64Array([-1581820178, 1096742736, 357083581]))


func test_next_float() -> void:
	var random: UtilRandom = UtilCore.create_random(42)
	assert_eq(UtilCore.next_float(random), 565663470.0 / 4294967296.0)


func test_shuffle_indices() -> void:
	var random: UtilRandom = UtilCore.create_random(42)
	assert_eq(UtilCore.shuffle_indices(random, 10), PackedInt64Array([1, 6, 7, 8, 4, 3, 9, 5, 2, 0]))


func test_pick_weighted() -> void:
	var random: UtilRandom = UtilCore.create_random(42)
	var weights: PackedInt64Array = PackedInt64Array([1, 0, 3, 6])
	var out: PackedInt64Array = PackedInt64Array()
	for i: int in 10:
		out.append(UtilCore.pick_weighted(random, weights))
	assert_eq(out, PackedInt64Array([0, 3, 3, 3, 3, 3, 3, 0, 3, 2]))


func test_make_purpose_seed() -> void:
	assert_eq(UtilCore.make_purpose_seed("battle_effect", 1700000000000), 1464768381546528617)
	assert_eq(UtilCore.make_purpose_seed("a", 0), -5808556873153909620)


func test_random_instances_with_the_same_seed_are_independent() -> void:
	var first: UtilRandom = UtilCore.create_random(42)
	var second: UtilRandom = UtilCore.create_random(42)
	assert_eq(UtilCore.next_uint32(first), 565663470)
	assert_eq(UtilCore.next_uint32(first), 3244226384)
	assert_eq(UtilCore.next_uint32(second), 565663470)
