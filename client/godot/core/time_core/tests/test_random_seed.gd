extends "res://core/time_core/tests/support/time_test_case.gd"
## `make_random_seed` and the DEV random base.

const INT64_MAX: int = 9223372036854775807
const INT64_MIN: int = -9223372036854775807 - 1


func test_a_random_base_gives_the_kth_seed_of_each_purpose_whatever_the_device_time() -> void:
	TimeCoreDev.set_random_base(42)
	init_modules()
	UnitTestCore.set_device_time(1700000000000)
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", 42))
	UnitTestCore.set_device_time(1800000000000)
	assert_eq(TimeCore.make_random_seed("b"), UtilCore.make_purpose_seed("b", 42), "another purpose counts by itself")
	advance(5000)
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", 43))
	TimeCore.release()
	TimeCoreDev.set_random_base(42)
	assert_true(TimeCore.init())
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", 42), "the count starts again at init")


func test_the_random_base_plus_the_count_wraps_in_64_bits() -> void:
	TimeCoreDev.set_random_base(INT64_MAX)
	init_modules()
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", INT64_MAX))
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", INT64_MIN))
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", INT64_MIN + 1))


func test_without_a_random_base_the_device_time_is_the_base_and_a_bad_purpose_is_not_counted() -> void:
	const DEVICE_TIME: int = 1700000000123
	init_modules()
	UnitTestCore.set_device_time(DEVICE_TIME)
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", DEVICE_TIME))
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", DEVICE_TIME + 1))
	assert_eq(TimeCore.make_random_seed("Abc"), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1, "a purpose name that is not snake_case")
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", DEVICE_TIME + 2))
	assert_eq(TimeCore.make_random_seed(""), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1, "an empty purpose name")
	assert_false(TimeCore._random_seed_counts.has("Abc") or TimeCore._random_seed_counts.has(""))


func test_add_int64_wraps_modulo_2_64() -> void:
	assert_eq(TimeCore._add_int64(INT64_MAX, 1), INT64_MIN)
	assert_eq(TimeCore._add_int64(-1, 1), 0)
	assert_eq(TimeCore._add_int64(-5, 3), -2)
	assert_eq(TimeCore._add_int64(0xFFFFFFFF, 1), 0x100000000)
	assert_eq(TimeCore._add_int64(INT64_MIN, -1), INT64_MAX)
	assert_eq(TimeCore._add_int64(1700000000123, 7), 1700000000130)


func test_set_random_base_after_init_is_an_error_and_ignored() -> void:
	init_modules()
	UnitTestCore.set_device_time(1700000000000)
	TimeCoreDev.set_random_base(42)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1)
	assert_eq(TimeCore.make_random_seed("a"), UtilCore.make_purpose_seed("a", 1700000000000))
