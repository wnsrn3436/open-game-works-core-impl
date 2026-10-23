extends "res://core/time_core/tests/support/time_test_case.gd"
## Server time sync: the estimate and `ServerTimeJumpedEvent`.


func test_server_time_is_server_time_at_plus_half_round_trip_plus_elapsed() -> void:
	init_modules()
	var sent: int = TimeCore.get_monotonic_time()
	advance(301)
	var received: int = TimeCore.get_monotonic_time()
	TimeCore.sync_server_time(SERVER_TIME, sent, received)
	assert_true(TimeCore.is_synced())
	assert_eq(TimeCore.get_server_time(), SERVER_TIME + UtilCore.floor_div(301, 2))
	advance(1234)
	assert_eq(TimeCore.get_server_time(), SERVER_TIME + UtilCore.floor_div(received - sent, 2) + 1234)


func test_jump_of_the_threshold_publishes_once_and_one_less_does_not() -> void:
	init_with_recorder()
	sync_to(SERVER_TIME)
	assert_eq(recorder.count("jumped"), 0, "the first sync does not publish")
	sync_to(SERVER_TIME + JUMP_THRESHOLD_MS - 1)
	assert_eq(recorder.count("jumped"), 0, "one less than the threshold does not publish")
	var before: int = TimeCore.get_server_time()
	sync_to(before + JUMP_THRESHOLD_MS)
	assert_eq(recorder.count("jumped"), 1)
	assert_eq(recorder.jump_previous[0], before)
	assert_eq(recorder.jump_current[0], before + JUMP_THRESHOLD_MS)
	sync_to(TimeCore.get_server_time() - JUMP_THRESHOLD_MS)
	assert_eq(recorder.count("jumped"), 2, "a jump back of the threshold publishes")


func test_jump_is_published_before_the_day_check_of_the_sync() -> void:
	init_with_recorder()
	sync_to(SERVER_TIME)
	sync_to(SERVER_TIME + 3 * DAY_MS)
	assert_eq(recorder.order, PackedStringArray(["jumped", "day"]))
