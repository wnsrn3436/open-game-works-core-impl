extends UnitTestCase
## `sha256_hex`, `is_snake_case`, `floor_div`, `floor_mod`, `clamp_int` and `apply_permille`.

const _INT64_MAX: int = 9223372036854775807
const _INT64_MIN: int = -9223372036854775807 - 1


func test_sha256_hex_of_empty_bytes() -> void:
	assert_eq(UtilCore.sha256_hex(PackedByteArray()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")


func test_sha256_hex_is_lowercase_hex() -> void:
	assert_eq(
		UtilCore.sha256_hex("abc".to_utf8_buffer()), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	)


func test_is_snake_case() -> void:
	assert_true(UtilCore.is_snake_case("abc_1"))
	assert_true(UtilCore.is_snake_case("a"))
	for text: String in PackedStringArray(["Abc", "1abc", "a__b", "a_", "", "_a", "a-b", "a b", "ab\u00e9"]):
		assert_false(UtilCore.is_snake_case(text), text)


func test_floor_div_and_floor_mod() -> void:
	assert_eq(UtilCore.floor_div(-7, 2), -4)
	assert_eq(UtilCore.floor_mod(-7, 2), 1)
	assert_eq(UtilCore.floor_div(7, 2), 3)
	assert_eq(UtilCore.floor_mod(7, 2), 1)
	assert_eq(UtilCore.floor_div(-8, 2), -4)
	assert_eq(UtilCore.floor_mod(-8, 2), 0)
	assert_eq(UtilCore.floor_div(_INT64_MIN, 3), -3074457345618258603)
	assert_eq(UtilCore.floor_mod(_INT64_MIN, 3), 1)


func test_floor_div_and_floor_mod_with_b_not_positive_return_0() -> void:
	assert_eq(UtilCore.floor_div(-7, 0), 0)
	assert_eq(UtilCore.floor_mod(-7, 0), 0)
	assert_eq(UtilCore.floor_div(7, -2), 0)
	assert_eq(UtilCore.floor_mod(7, -2), 0)


func test_clamp_int() -> void:
	assert_eq(UtilCore.clamp_int(5, 1, 3), 3)
	assert_eq(UtilCore.clamp_int(-5, 1, 3), 1)
	assert_eq(UtilCore.clamp_int(2, 1, 3), 2)
	assert_eq(UtilCore.clamp_int(2, 4, 3), 4)


func test_apply_permille() -> void:
	_assert_permille(UtilCore.apply_permille(1001, 500), true, 500)
	_assert_permille(UtilCore.apply_permille(-1001, 500), true, -501)
	_assert_permille(UtilCore.apply_permille(1000, -1), true, -1)
	_assert_permille(UtilCore.apply_permille(_INT64_MIN, 1), true, -9223372036854776)
	_assert_permille(UtilCore.apply_permille(_INT64_MAX, -1), true, -9223372036854776)


func test_apply_permille_overflow_fails() -> void:
	_assert_permille(UtilCore.apply_permille(_INT64_MAX, 2), false, 0)
	_assert_permille(UtilCore.apply_permille(_INT64_MIN, -1), false, 0)
	_assert_permille(UtilCore.apply_permille(_INT64_MIN, 2), false, 0)
	_assert_permille(UtilCore.apply_permille(9223372036854776, 1000), false, 0)
	_assert_permille(UtilCore.apply_permille(-9223372036854776, -1000), false, 0)
	_assert_permille(UtilCore.apply_permille(-9223372036854776, 1000), false, 0)
	_assert_permille(UtilCore.apply_permille(-9223372036854775, 1000), true, -9223372036854775)


func _assert_permille(result: ApplyPermilleResult, ok: bool, value: int) -> void:
	assert_eq(result.ok, ok)
	assert_eq(result.value, value)
