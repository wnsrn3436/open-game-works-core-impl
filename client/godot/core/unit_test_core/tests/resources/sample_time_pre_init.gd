extends UnitTestCase
## Sample test file of the nested runs: the first test sets the `TimeCoreDev` values that `TimeCore` keeps from before
## its `init` until its `release` and never `init`s TimeCore; the second `init`s TimeCore and looks for them, then sets
## them again for the end of the run.

const RANDOM_BASE: int = 42
const FRAME_STEP_FPS: int = 30
const PURPOSE: String = "sample_purpose"


func test_a_sets_values_before_init_without_init() -> void:
	TimeCoreDev.set_random_base(RANDOM_BASE)
	TimeCoreDev.set_frame_step(FRAME_STEP_FPS)
	assert_false(TimeCore.is_initialized(), "TimeCore is not initialized")


func test_b_does_not_find_them() -> void:
	assert_true(LogCore.init() and EventCore.init() and TimeCore.init(), "LogCore, EventCore and TimeCore init")
	assert_eq(TimeCoreDev.get_frame_step_fps(), 0, "frame step of the test before")
	var device_seed: int = UtilCore.make_purpose_seed(PURPOSE, UnitTestCore._run.clock.device_time_ms)
	assert_eq(TimeCore.make_random_seed(PURPOSE), device_seed, "random base of the test before")
	TimeCore.release()
	TimeCoreDev.set_random_base(RANDOM_BASE)
	TimeCoreDev.set_frame_step(FRAME_STEP_FPS)
