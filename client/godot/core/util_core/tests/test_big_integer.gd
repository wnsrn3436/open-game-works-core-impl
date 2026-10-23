extends UnitTestCase
## Big integer operations: results, the big integer form and failure values.

const _INVALID: PackedStringArray = ["01", "-0", "+1", "1e3", " 1", "", "-", "1 ", "1.0", "--1", "\u0661"]


func test_spec_results() -> void:
	assert_eq(UtilCore.big_add("9223372036854775807", "1"), "9223372036854775808")
	assert_eq(UtilCore.big_sub("5", "5"), "0")
	assert_eq(UtilCore.big_mul("-3", "0"), "0")
	assert_eq(UtilCore.big_floor_div("-7", "2"), "-4")
	assert_eq(UtilCore.big_apply_permille("1001", 500), "500")
	_assert_compare(UtilCore.big_compare("-10", "9"), true, -1)
	_assert_to_int(UtilCore.big_to_int("9223372036854775808"), false, 0)


func test_results_match_integer_arithmetic() -> void:
	var a: String = "123456789012345678901234567890"
	var b: String = "987654321987654321"
	assert_eq(UtilCore.big_add(a, "-" + b), "123456789011358024579246913569")
	assert_eq(UtilCore.big_sub("-" + b, a), "-123456789013333333223222222211")
	assert_eq(UtilCore.big_mul(a, "-" + b), "-121932631246761163237311385323609205901126352690")
	assert_eq(UtilCore.big_floor_div(a, b), "124999998748")
	assert_eq(UtilCore.big_floor_div("-" + a, b), "-124999998749")
	assert_eq(UtilCore.big_floor_div("-" + b, "1000000000000000000000"), "-1")
	assert_eq(UtilCore.big_floor_div("0", b), "0")
	assert_eq(UtilCore.big_floor_div("-1000000000", "1000000000"), "-1")
	assert_eq(UtilCore.big_apply_permille("-1001", 500), "-501")
	assert_eq(UtilCore.big_apply_permille("1000", -9223372036854775807 - 1), "-9223372036854775808")
	assert_eq(UtilCore.big_add("999999999999999999", "1"), "1000000000000000000")
	assert_eq(UtilCore.big_sub("1000000000000000000", "1"), "999999999999999999")
	_assert_compare(UtilCore.big_compare("10", "9"), true, 1)
	_assert_compare(UtilCore.big_compare("-10", "-9"), true, -1)
	_assert_compare(UtilCore.big_compare(a, a), true, 0)


func test_results_never_write_minus_zero() -> void:
	assert_eq(UtilCore.big_add("-5", "5"), "0")
	assert_eq(UtilCore.big_sub("-5", "-5"), "0")
	assert_eq(UtilCore.big_mul("-5", "0"), "0")
	assert_eq(UtilCore.big_floor_div("0", "7"), "0")
	assert_eq(UtilCore.big_apply_permille("-1", 0), "0")


func test_int64_conversion() -> void:
	assert_eq(UtilCore.big_from_int(-9223372036854775807 - 1), "-9223372036854775808")
	assert_eq(UtilCore.big_from_int(0), "0")
	_assert_to_int(UtilCore.big_to_int("-9223372036854775808"), true, -9223372036854775807 - 1)
	_assert_to_int(UtilCore.big_to_int("9223372036854775807"), true, 9223372036854775807)
	_assert_to_int(UtilCore.big_to_int("-9223372036854775809"), false, 0)
	_assert_to_int(UtilCore.big_to_int("-42"), true, -42)


func test_invalid_text_is_not_a_big_integer_and_fails_every_operation() -> void:
	assert_true(UtilCore.big_is_valid("0"))
	assert_true(UtilCore.big_is_valid("-12"))
	for text: String in _INVALID:
		assert_false(UtilCore.big_is_valid(text), text)
		_assert_to_int(UtilCore.big_to_int(text), false, 0)
		_assert_compare(UtilCore.big_compare(text, "1"), false, 0)
		_assert_compare(UtilCore.big_compare("1", text), false, 0)
		assert_eq(UtilCore.big_add(text, "1"), "", text)
		assert_eq(UtilCore.big_add("1", text), "", text)
		assert_eq(UtilCore.big_sub(text, "1"), "", text)
		assert_eq(UtilCore.big_sub("1", text), "", text)
		assert_eq(UtilCore.big_mul(text, "1"), "", text)
		assert_eq(UtilCore.big_mul("1", text), "", text)
		assert_eq(UtilCore.big_floor_div(text, "1"), "", text)
		assert_eq(UtilCore.big_floor_div("1", text), "", text)
		assert_eq(UtilCore.big_apply_permille(text, 500), "", text)


func test_big_floor_div_with_b_not_positive_fails() -> void:
	assert_eq(UtilCore.big_floor_div("7", "0"), "")
	assert_eq(UtilCore.big_floor_div("7", "-2"), "")


func _assert_compare(result: BigCompareResult, ok: bool, value: int) -> void:
	assert_eq(result.ok, ok)
	assert_eq(result.value, value)


func _assert_to_int(result: BigToIntResult, ok: bool, value: int) -> void:
	assert_eq(result.ok, ok)
	assert_eq(result.value, value)
