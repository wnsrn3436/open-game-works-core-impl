extends UnitTestCase
## Sample test file of a GUT run that ends early: the first test leaves LogCore initialized and an app storage file,
## and waits for an event that never comes. The run time limit ends the run; the second test must not start.

const FILE: String = "user://unit_test_core_sample/early_end.txt"

## Test functions that started, in order.
static var started: PackedStringArray = PackedStringArray()


func test_a_waits_past_the_run_time_limit() -> void:
	started.append("test_a_waits_past_the_run_time_limit")
	assert_true(LogCore.init(), "LogCore.init")
	assert_true(EventCore.init(), "EventCore.init")
	assert_eq(DirAccess.make_dir_recursive_absolute(FILE.get_base_dir()), OK)
	var file: FileAccess = FileAccess.open(FILE, FileAccess.WRITE)
	assert_not_null(file, "an app storage file")
	if file != null:
		file.store_string("early")
		file.close()
	var latch: UnitTestLatch = UnitTestCore.latch_event(AppQuitEvent)
	await UnitTestCore.wait_latch(latch)


func test_b_does_not_start() -> void:
	started.append("test_b_does_not_start")
