extends UnitTestCase
## Sample test file of the nested runs: `require_platform` with and without the platform of the run.


func test_requires_another_platform() -> void:
	UnitTestCore.require_platform(PackedStringArray(["no_such_platform"]))
	assert_true(true)


func test_requires_this_platform() -> void:
	UnitTestCore.require_platform(PackedStringArray([CoreBuildInfo.platform]))
	assert_true(true)
