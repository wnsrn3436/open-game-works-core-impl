extends UnitTestCase
## Sample test file of the nested runs: the first test leaves a test boot whose module list ends with a module whose
## `release` logs an error, so the setup of the second test logs that error when it releases the modules.

const _PROBE := preload("res://core/unit_test_core/tests/support/release_log_probe.gd")


func _entry(module_name: String, init: Callable, release: Callable, is_initialized: Callable) -> CoreModuleEntry:
	var entry: CoreModuleEntry = CoreModuleEntry.new()
	entry.name = module_name
	entry.init = init
	entry.release = release
	entry.is_initialized = is_initialized
	return entry


func test_a_leaves_a_module_that_logs_in_its_release() -> void:
	var modules: Array[CoreModuleEntry] = [
		_entry("LogCore", LogCore.init, LogCore.release, LogCore.is_initialized),
		_entry("EventCore", EventCore.init, EventCore.release, EventCore.is_initialized),
		_entry("TimeCore", TimeCore.init, TimeCore.release, TimeCore.is_initialized),
		_entry("ReleaseLogProbe", _PROBE.init, _PROBE.release, _PROBE.is_initialized),
	]
	var booted: UnitTestLatch = UnitTestCore.latch_event(BootCompletedEvent)
	UnitTestCore.start_test_boot(ContentEntry.new(), modules)
	await UnitTestCore.wait_latch(booted)
	assert_true(_PROBE.is_initialized(), "probe init")


func test_b_runs_after_it() -> void:
	assert_true(true)
