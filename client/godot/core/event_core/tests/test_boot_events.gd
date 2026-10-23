extends UnitTestCase
## Boot event payloads that `BootstrapCore` publishes: `BootCompletedEvent.duration_ms`.

## Test clock time each `content_init` moves ahead. A `duration_ms` read from the test clock would be at least this.
const _TEST_CLOCK_ADVANCE_MS: int = 1000000
## Device monotonic time between the first boot and the restart request. A `duration_ms` of the boot after the restart
## counted from the first boot would hold it.
const _GAP_MS: int = 300


## `duration_ms` is the device monotonic time from the start of that boot: within the time the test reads around the
## boot, also for the boot after a restart, and never the test clock.
func test_boot_completed_duration_is_within_the_device_monotonic_time_of_each_boot() -> void:
	var entry: EventCoreTestBootEntry = EventCoreTestBootEntry.new()
	entry.test_clock_advance_ms = _TEST_CLOCK_ADVANCE_MS
	var booted: UnitTestLatch = UnitTestCore.latch_event(BootCompletedEvent)
	var started_ms: int = Time.get_ticks_msec()
	UnitTestCore.start_test_boot(entry, _boot_modules())
	await UnitTestCore.wait_latch(booted)
	# The latch resumes the test inside the publish of the event, before the entry gets it.
	await UnitTestCore.wait_frames(1)
	assert_eq(entry.durations.size(), 1, "first boot done")
	if entry.durations.size() != 1:
		return
	assert_between(entry.durations[0], 0, entry.received_at_ms[0] - started_ms)

	OS.delay_msec(_GAP_MS)
	var restarted: UnitTestLatch = UnitTestCore.latch_event(BootCompletedEvent)
	var requested_ms: int = Time.get_ticks_msec()
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(restarted)
	await UnitTestCore.wait_frames(1)
	assert_eq(entry.durations.size(), 2, "boot after the restart done")
	if entry.durations.size() != 2:
		return
	assert_between(entry.durations[1], 0, entry.received_at_ms[1] - requested_ms)


func _entry(module_name: String, init: Callable, release: Callable, is_initialized: Callable) -> CoreModuleEntry:
	var entry: CoreModuleEntry = CoreModuleEntry.new()
	entry.name = module_name
	entry.init = init
	entry.release = release
	entry.is_initialized = is_initialized
	return entry


## Module list of a test boot with no data, translation, scene, UI or login stage.
func _boot_modules() -> Array[CoreModuleEntry]:
	var modules: Array[CoreModuleEntry] = []
	modules.append(_entry("LogCore", LogCore.init, LogCore.release, LogCore.is_initialized))
	modules.append(_entry("EventCore", EventCore.init, EventCore.release, EventCore.is_initialized))
	modules.append(_entry("TimeCore", TimeCore.init, TimeCore.release, TimeCore.is_initialized))
	return modules
