extends UnitTestCase
## Sample test file of the nested runs: the first test leaves modules initialized, the second initializes them again.


func test_a_leaves_modules_initialized() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_true(EventCore.init(), "EventCore.init")


func test_b_initializes_them_again() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_true(EventCore.init(), "EventCore.init")
