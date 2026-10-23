extends UnitTestCase
## Sample test file of the nested runs: the first test awaits a signal that nothing emits, as a test that awaits the
## engine signal of a play that never ends. The test time limit cannot end such a wait.


## Object with a signal that nothing emits.
class Never extends RefCounted:
	signal came


## The object the first test waits on. The test that runs this file drops it after the run, which frees the wait.
static var never: Never = null


func test_a_awaits_a_signal_that_never_comes() -> void:
	never = Never.new()
	await never.came


func test_b_runs_after_it() -> void:
	assert_true(true)
