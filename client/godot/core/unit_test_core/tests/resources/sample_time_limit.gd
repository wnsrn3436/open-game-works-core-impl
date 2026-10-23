extends UnitTestCase
## Sample test file of the nested runs: the first test waits for an event that never comes.


func test_a_waits_past_the_time_limit() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_true(EventCore.init(), "EventCore.init")
	var latch: UnitTestLatch = UnitTestCore.latch_event(AppQuitEvent)
	assert_false(await UnitTestCore.wait_latch(latch))


func test_b_runs_after_it() -> void:
	assert_true(true)
