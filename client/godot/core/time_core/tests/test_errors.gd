extends "res://core/time_core/tests/support/time_test_case.gd"
## The rows of the error table: failure values and `error` logs.

const OUT_OF_RANGE_OFFSETS: PackedInt64Array = [DAY_MS, -DAY_MS, DAY_MS + 1, -DAY_MS - 1]
const IN_RANGE_OFFSETS: PackedInt64Array = [DAY_MS - 1, -DAY_MS + 1, 0]


func test_server_time_reads_before_the_first_sync_fail() -> void:
	init_modules()
	assert_false(TimeCore.is_synced())
	assert_eq(TimeCore.get_server_time(), 0)
	assert_false(TimeCore.is_reached(0))
	assert_false(TimeCore.is_before_end(SERVER_TIME))
	assert_eq(TimeCore.get_remaining_ms(SERVER_TIME), 0)
	assert_eq(TimeCore.get_current_day(), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 5)


func test_sync_with_received_before_sent_is_ignored() -> void:
	init_modules()
	advance(100)
	TimeCore.sync_server_time(SERVER_TIME, 100, 99)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1)
	assert_false(TimeCore.is_synced(), "the first sync is ignored")
	sync_to(SERVER_TIME)
	TimeCore.sync_server_time(SERVER_TIME + DAY_MS, 100, 99)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1)
	assert_eq(TimeCore.get_server_time(), SERVER_TIME, "the server time stays")


func test_sync_with_server_time_at_not_positive_is_ignored() -> void:
	init_modules()
	TimeCore.sync_server_time(0, 0, 0)
	TimeCore.sync_server_time(-1, 0, 0)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 2)
	assert_false(TimeCore.is_synced())
	sync_to(SERVER_TIME)
	TimeCore.sync_server_time(0, 0, 0)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1)
	assert_eq(TimeCore.get_server_time(), SERVER_TIME)


func test_daily_reset_offset_out_of_range_logs_once_in_init_and_uses_0() -> void:
	assert_true(LogCore.init())
	for offset: int in OUT_OF_RANGE_OFFSETS:
		reinit_with_offset(offset)
		assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1, "offset %d" % offset)
		var time: int = boundary(0)
		assert_eq(TimeCore.get_day_start(time), time)
		assert_eq(TimeCore.get_day_start(time - 1), time - DAY_MS)
		assert_eq(TimeCore.get_day_number(time), UtilCore.floor_div(time, DAY_MS))
		assert_eq(UnitTestCore.check_logs(ERROR, TAG), 0, "no log after init")


func test_daily_reset_offset_inside_the_range_has_no_log() -> void:
	assert_true(LogCore.init())
	for offset: int in IN_RANGE_OFFSETS:
		reinit_with_offset(offset)
		assert_eq(TimeCore.get_day_start(boundary(offset)), boundary(offset))
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 0)


func test_time_scale_of_0_or_less_is_ignored() -> void:
	init_modules()
	TimeCore.set_time_scale(1500)
	TimeCore.set_time_scale(0)
	TimeCore.set_time_scale(-1000)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 2)
	assert_eq(TimeCore.get_time_scale(), 1500)
	assert_eq(Engine.time_scale, 1.5)
	advance(1000)
	assert_eq(TimeCore.get_game_time(), 1500)
