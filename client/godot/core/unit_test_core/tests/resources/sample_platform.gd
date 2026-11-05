extends UnitTestCase
## Sample test file of the nested runs: `require_platform` with and without the platform of the run.

## What `require_platform` gave, by test function.
static var returned: Dictionary[String, bool] = {}


func test_requires_another_platform() -> void:
	var goes_on: bool = UnitTestCore.require_platform(PackedStringArray(["no_such_platform"]))
	returned["test_requires_another_platform"] = goes_on
	if not goes_on:
		return
	assert_true(false, "the body after false ran")


## A failure before the call fails the test, not skips it.
func test_fails_then_requires_another_platform() -> void:
	assert_true(false, "an assert failure before the skip")
	assert_false(UnitTestCore.require_platform(PackedStringArray(["no_such_platform"])), "false for a list without it")


## A body that goes on after `false`: an assert failure and an unchecked error log after it fail the test.
func test_requires_another_platform_then_fails() -> void:
	returned["test_requires_another_platform_then_fails"] = UnitTestCore.require_platform(
			PackedStringArray(["no_such_platform"]))
	assert_true(false, "an assert failure after the skip")
	assert_true(LogCore.init(), "LogCore.init")
	LogCore.log_error("Sample", "an error log after the skip")


func test_requires_this_platform() -> void:
	returned["test_requires_this_platform"] = UnitTestCore.require_platform(PackedStringArray([CoreBuildInfo.platform]))
	assert_true(true)
