extends UnitTestCase
## Sample test file of the nested runs: a passing test and a failing test.


func test_passes() -> void:
	assert_eq(1 + 1, 2)


func test_fails() -> void:
	assert_eq(1 + 1, 3, "sample failure")
