extends UnitTestCase
## Sample test file of the nested runs: an unchecked error log, a checked one, and a warn log.


func test_unchecked_error_log() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	LogCore.log_error("Sample", "not checked")


func test_checked_error_log() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	LogCore.log_error("Sample", "checked")
	assert_eq(UnitTestCore.check_logs("error", "Sample"), 1)


func test_warn_log() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	LogCore.log_warn("Sample", "warn")
