extends "res://core/time_core/tests/support/time_test_case.gd"
## Background entry and return.


func test_background_step_counts_a_return_and_keeps_game_and_real_time() -> void:
	init_with_recorder()
	advance(100)
	var game: int = TimeCore.get_game_time()
	var real: int = TimeCore.get_real_time()
	UnitTestCore.advance_clock(5000, true)
	assert_eq(TimeCore.get_resume_count(), 1)
	assert_eq(TimeCore.get_last_background_ms(), 5000)
	assert_eq(TimeCore.get_game_time(), game)
	assert_eq(TimeCore.get_real_time(), real)
	assert_eq(recorder.order, PackedStringArray(["background", "foreground"]))
	assert_eq(recorder.background_ms, PackedInt64Array([5000]))
	assert_eq(recorder.resume_counts, PackedInt64Array([1]))
	UnitTestCore.advance_clock(700, true)
	assert_eq(TimeCore.get_resume_count(), 2)
	assert_eq(TimeCore.get_last_background_ms(), 700)
	assert_eq(TimeCore.get_game_time(), game)
	assert_eq(TimeCore.get_real_time(), real)
	assert_eq(recorder.order, PackedStringArray(["background", "foreground", "background", "foreground"]))
	assert_eq(recorder.resume_counts, PackedInt64Array([1, 2]))


func test_no_return_gives_0() -> void:
	init_modules()
	assert_eq(TimeCore.get_resume_count(), 0)
	assert_eq(TimeCore.get_last_background_ms(), 0)


func test_server_time_after_an_asleep_background_step() -> void:
	init_with_recorder()
	sync_to(SERVER_TIME)
	var monotonic: int = TimeCore.get_monotonic_time()
	UnitTestCore.advance_clock(8000, false, true)
	assert_eq(TimeCore.get_monotonic_time(), monotonic, "the monotonic time does not move while asleep")
	assert_eq(TimeCore.get_last_background_ms(), 8000)
	assert_eq(recorder.server_time_at_foreground, PackedInt64Array([SERVER_TIME + 8000]))
	assert_eq(TimeCore.get_server_time(), SERVER_TIME + 8000)


func test_server_time_after_an_awake_background_step() -> void:
	init_with_recorder()
	sync_to(SERVER_TIME)
	UnitTestCore.advance_clock(8000, true)
	assert_eq(TimeCore.get_last_background_ms(), 8000)
	assert_eq(recorder.server_time_at_foreground, PackedInt64Array([SERVER_TIME + 8000]))
	assert_eq(TimeCore.get_server_time(), SERVER_TIME + 8000)


func test_engine_background_notifications_enter_and_return_once() -> void:
	init_with_recorder()
	var node: Node = TimeCore._node
	node.propagate_notification(Node.NOTIFICATION_APPLICATION_PAUSED)
	node.propagate_notification(Node.NOTIFICATION_APPLICATION_PAUSED)
	UnitTestCore.set_device_time(TimeCore.get_device_time() + 3000)
	node.propagate_notification(Node.NOTIFICATION_APPLICATION_RESUMED)
	node.propagate_notification(Node.NOTIFICATION_APPLICATION_RESUMED)
	assert_eq(recorder.order, PackedStringArray(["background", "foreground"]))
	assert_eq(TimeCore.get_resume_count(), 1)
	assert_eq(TimeCore.get_last_background_ms(), 3000, "the larger of the monotonic and the device difference")
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0, "the second entry and return are ignored without a log")
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 0)


func test_engine_return_without_an_entry_after_init_is_ignored() -> void:
	init_with_recorder()
	sync_to(SERVER_TIME)
	TimeCore._node.propagate_notification(Node.NOTIFICATION_APPLICATION_RESUMED)
	assert_eq(TimeCore.get_resume_count(), 0)
	assert_eq(TimeCore.get_last_background_ms(), 0)
	assert_eq(TimeCore.get_server_time(), SERVER_TIME)
	assert_eq(recorder.order, PackedStringArray(), "no event")
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0, "no log")
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 0)


## LogCore deletes its running marker for `background` and makes it for `foreground`, and TimeCore tells it before each
## event: the callbacks already see the new marker state.
func test_log_core_hears_the_app_state_before_each_event() -> void:
	init_with_recorder()
	assert_true(FileAccess.file_exists(recorder.marker_path()), "LogCore made the running marker in init")
	UnitTestCore.advance_clock(1000, true)
	assert_eq(recorder.marker_at_background, [false] as Array[bool], "no marker inside the background callback")
	assert_eq(recorder.marker_at_foreground, [true] as Array[bool], "the marker is back inside the foreground callback")
	assert_true(FileAccess.file_exists(recorder.marker_path()))
	var node: Node = TimeCore._node
	node.propagate_notification(Node.NOTIFICATION_APPLICATION_PAUSED)
	assert_false(FileAccess.file_exists(recorder.marker_path()), "the engine background entry deletes the marker")
	node.propagate_notification(Node.NOTIFICATION_APPLICATION_RESUMED)
	assert_true(FileAccess.file_exists(recorder.marker_path()), "the engine background return makes the marker")
	assert_eq(recorder.marker_at_background, [false, false] as Array[bool])
	assert_eq(recorder.marker_at_foreground, [true, true] as Array[bool])
