extends UnitTestCase
## Sample test file of the nested runs: `require_platform` with and without the platform of the run.


func test_requires_another_platform() -> void:
	UnitTestCore.require_platform(PackedStringArray(["no_such_platform"]))
	assert_true(true)


## The body goes on after the call: an assert failure and an unchecked error log after it do not change the skip.
func test_requires_another_platform_then_fails() -> void:
	UnitTestCore.require_platform(PackedStringArray(["no_such_platform"]))
	assert_true(false, "an assert failure after the skip")
	assert_true(LogCore.init(), "LogCore.init")
	LogCore.log_error("Sample", "an error log after the skip")


func test_requires_this_platform() -> void:
	UnitTestCore.require_platform(PackedStringArray([CoreBuildInfo.platform]))
	assert_true(true)
