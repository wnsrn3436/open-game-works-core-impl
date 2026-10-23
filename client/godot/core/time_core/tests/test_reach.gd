extends "res://core/time_core/tests/support/time_test_case.gd"
## `is_reached`, `get_remaining_ms` and `is_before_end` around the reach margin.


func test_is_reached_and_remaining_at_target_plus_margin() -> void:
	init_modules()
	var target: int = SERVER_TIME
	sync_to(target + MARGIN_MS - 1)
	assert_false(TimeCore.is_reached(target))
	assert_eq(TimeCore.get_remaining_ms(target), 1)
	advance(1)
	assert_true(TimeCore.is_reached(target))
	assert_eq(TimeCore.get_remaining_ms(target), 0)
	advance(1000)
	assert_eq(TimeCore.get_remaining_ms(target), 0, "the remaining time is not below 0")


func test_is_before_end_at_end_minus_margin() -> void:
	init_modules()
	var end: int = SERVER_TIME
	sync_to(end - MARGIN_MS - 1)
	assert_true(TimeCore.is_before_end(end))
	advance(1)
	assert_false(TimeCore.is_before_end(end))


func test_targets_at_the_int64_ends_do_not_wrap() -> void:
	const INT64_MAX: int = 9223372036854775807
	const INT64_MIN: int = -9223372036854775807 - 1
	init_modules()
	sync_to(SERVER_TIME)
	assert_false(TimeCore.is_reached(INT64_MAX))
	assert_eq(TimeCore.get_remaining_ms(INT64_MAX), INT64_MAX - (SERVER_TIME - MARGIN_MS))
	assert_true(TimeCore.is_before_end(INT64_MAX))
	assert_true(TimeCore.is_reached(INT64_MIN))
	assert_eq(TimeCore.get_remaining_ms(INT64_MIN), 0)
	assert_false(TimeCore.is_before_end(INT64_MIN))
