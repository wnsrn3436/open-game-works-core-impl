extends UnitTestCase
## Test clock: `advance_clock`, `set_device_time`, and the time `TimeCore` reads.

const START_DEVICE_MS: int = 1700000000000


func _start_time_core() -> bool:
	var started: bool = LogCore.init() and EventCore.init() and TimeCore.init()
	assert_true(started, "LogCore, EventCore and TimeCore init")
	return started


func test_time_stays_without_advance_clock() -> void:
	if not _start_time_core():
		return
	assert_eq(TimeCore.get_monotonic_time(), 0)
	assert_eq(TimeCore.get_device_time(), START_DEVICE_MS)
	await UnitTestCore.wait_frames(3)
	assert_eq(TimeCore.get_monotonic_time(), 0)
	assert_eq(TimeCore.get_device_time(), START_DEVICE_MS)


func test_advance_clock_moves_both_times_and_device_sleep_only_the_device_time() -> void:
	if not _start_time_core():
		return
	UnitTestCore.advance_clock(250, false)
	assert_eq(TimeCore.get_monotonic_time(), 250)
	assert_eq(TimeCore.get_device_time(), START_DEVICE_MS + 250)
	UnitTestCore.advance_clock(1000, false, true)
	assert_eq(TimeCore.get_monotonic_time(), 250)
	assert_eq(TimeCore.get_device_time(), START_DEVICE_MS + 1250)


func test_negative_advance_clock_logs_an_error_and_keeps_the_time() -> void:
	if not _start_time_core():
		return
	UnitTestCore.advance_clock(-1, false)
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1)
	assert_eq(TimeCore.get_monotonic_time(), 0)
	assert_eq(TimeCore.get_device_time(), START_DEVICE_MS)


func test_advance_clock_without_time_core_moves_only_the_test_clock() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	UnitTestCore.advance_clock(500, true)
	assert_eq(UnitTestCore._run.clock.monotonic_ms, 500)
	assert_eq(UnitTestCore._run.clock.device_time_ms, START_DEVICE_MS + 500)


func test_device_sleep_is_a_background_stay_of_time_core() -> void:
	if not _start_time_core():
		return
	var entered: UnitTestLatch = UnitTestCore.latch_event(AppBackgroundEnteredEvent)
	var returned: UnitTestLatch = UnitTestCore.latch_event(AppForegroundReturnedEvent)
	UnitTestCore.advance_clock(4000, false, true)
	assert_true(entered.happened, "background entered")
	assert_true(returned.happened, "background returned")
	assert_eq(TimeCore.get_resume_count(), 1)
	assert_eq(TimeCore.get_last_background_ms(), 4000)


func test_set_device_time_keeps_the_monotonic_time() -> void:
	if not _start_time_core():
		return
	UnitTestCore.set_device_time(START_DEVICE_MS + 86400000)
	assert_eq(TimeCore.get_device_time(), START_DEVICE_MS + 86400000)
	assert_eq(TimeCore.get_monotonic_time(), 0)
