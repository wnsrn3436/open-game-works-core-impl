extends UnitTestCase
## Sample test file of the nested runs: the first test leaves test values, requests and logs behind, the second looks
## for them.

const KEY: String = "UnitTestCore.testTimeLimitMs"
const VALUE: int = 4321


func test_a_leaves_state_behind() -> void:
	assert_true(UnitTestCore.set_test_settings(KEY, VALUE), "set_test_settings")
	assert_true(LogCore.init(), "LogCore.init")
	LogCore.log_warn("Sample", "warn of the test before")
	UnitTestCore.add_result("core/Sample", NetworkCore.TransferResult.DONE, 200, PackedByteArray())
	UnitTestCore.advance_clock(1000, false)
	assert_eq(UnitTestCore.check_logs("warn", "Sample"), 1)


func test_b_does_not_find_it() -> void:
	assert_ne(CoreSettings.get_int(KEY), VALUE, "test value of the test before")
	assert_false(LogCore.is_initialized(), "module of the test before")
	assert_true(UnitTestCore.received_requests().is_empty(), "requests of the test before")
	assert_eq(UnitTestCore._run.clock.monotonic_ms, 0, "monotonic time")
	assert_eq(UnitTestCore._run.clock.device_time_ms, UnitTestCore._CLOCK_START_DEVICE_MS, "device time")
	assert_eq(UnitTestCore.check_logs("warn", "Sample"), 0, "logs of the test before")
