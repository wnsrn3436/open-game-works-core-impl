extends UnitTestCase
## Test replacements: the modules a test `init`s and the modules of a test boot, its restart and update reboot
## included, use the test clock, the fake network and the log collector, and `RealtimeCore` the fake realtime transport
## of the test boot.

const Probe := preload("res://core/unit_test_core/tests/support/replacement_probe.gd")


func _entry(module_name: String, init: Callable, release: Callable, is_initialized: Callable) -> CoreModuleEntry:
	var entry: CoreModuleEntry = CoreModuleEntry.new()
	entry.name = module_name
	entry.init = init
	entry.release = release
	entry.is_initialized = is_initialized
	return entry


## Module list of the test boot: no translation, scene, UI or login stage, so the boot needs no test resource or
## response. `DataCore` loads the core test data: `NetworkCore` sends its data version in the request header.
func _modules() -> Array[CoreModuleEntry]:
	var modules: Array[CoreModuleEntry] = [
		_entry("LogCore", LogCore.init, LogCore.release, LogCore.is_initialized),
		_entry("EventCore", EventCore.init, EventCore.release, EventCore.is_initialized),
		_entry("TimeCore", TimeCore.init, TimeCore.release, TimeCore.is_initialized),
		_entry("LocalDataCore", LocalDataCore.init, LocalDataCore.release, LocalDataCore.is_initialized),
		_entry("DataCore", DataCore.init, DataCore.release, DataCore.is_initialized),
		_entry("NetworkCore", NetworkCore.init, NetworkCore.release, NetworkCore.is_initialized),
		_entry("RealtimeCore", RealtimeCore.init, RealtimeCore.release, RealtimeCore.is_initialized),
	]
	return modules


## Releases the modules in the test, so the held request ends before the test does.
func _release_modules(sender: Probe.AuthSender) -> void:
	BootstrapCoreDev.shutdown()
	await UnitTestCore.wait_frames(1)
	assert_not_null(sender.result, "the held request ended")


func test_modules_a_test_inits_use_the_replacements() -> void:
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and DataCore.init()
		and NetworkCore.init()
	)
	assert_true(started, "LogCore, EventCore, TimeCore, LocalDataCore, DataCore and NetworkCore init")
	if not started:
		return
	# `NetworkCore` sends the data version of `DataCore` in the request header.
	assert_true(await DataCore.load(null), "DataCore.load")
	assert_true(NetworkCore.set_server_info("http://127.0.0.1", "1.0.0", CoreBuildInfo.platform), "set_server_info")
	var sender: Probe.AuthSender = Probe.AuthSender.new()
	assert_eq(Probe.problems(0, sender), PackedStringArray())
	await _release_modules(sender)


func test_test_boot_and_its_restart_use_the_replacements() -> void:
	var realtime: UnitTestRealtimeTransport = UnitTestCore.create_fake_realtime()
	var booted: UnitTestLatch = UnitTestCore.latch_event(BootCompletedEvent)
	UnitTestCore.start_test_boot(ContentEntry.new(), _modules(), realtime)
	await UnitTestCore.wait_latch(booted)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE, "first boot done")
	var sender: Probe.AuthSender = Probe.AuthSender.new()
	assert_eq(Probe.problems(0, sender), PackedStringArray(), "first boot")
	var polls: int = realtime._poll_count
	await UnitTestCore.wait_frames(2)
	assert_gt(realtime._poll_count, polls, "RealtimeCore polls the fake realtime transport")
	var restarted: UnitTestLatch = UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(restarted)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE, "boot after the restart done")
	assert_not_null(sender.result, "the restart ended the held request")
	var after: Probe.AuthSender = Probe.AuthSender.new()
	assert_eq(Probe.problems(1, after), PackedStringArray(), "boot after the restart")
	polls = realtime._poll_count
	await UnitTestCore.wait_frames(2)
	assert_gt(realtime._poll_count, polls, "RealtimeCore polls the fake realtime transport after the restart")
	await _release_modules(after)


## The first boot downloads a bundle, the update downloads of the test boot: its update set differs, so it ends in
## an update reboot. The module list has no `ResourceCore`, so the reboot does not apply the bundle.
func test_boot_after_an_update_reboot_uses_the_replacements() -> void:
	var downloads := BootTestReplacements.UpdateDownloads.new()
	var bundle: DownloadedBundle = DownloadedBundle.new()
	bundle.name = "unit_test_bundle"
	bundle.path = "update/unit_test_bundle.pck"
	bundle.sha256 = "0".repeat(64)
	downloads.bundles.append(bundle)
	var modules: Array[CoreModuleEntry] = _modules()
	modules.append(_entry("GameUpdateCore", GameUpdateCore.init, GameUpdateCore.release, GameUpdateCore.is_initialized))
	var realtime: UnitTestRealtimeTransport = UnitTestCore.create_fake_realtime()
	var booted: UnitTestLatch = UnitTestCore.latch_event(BootCompletedEvent)
	UnitTestCore.start_test_boot(ContentEntry.new(), modules, realtime, "", downloads)
	await UnitTestCore.wait_latch(booted)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE, "boot after the update reboot done")
	assert_true(BootstrapCoreDev.is_update_reboot(), "the boot that ended is the update reboot")
	var sender: Probe.AuthSender = Probe.AuthSender.new()
	assert_eq(Probe.problems(UnitTestCore.received_requests().size(), sender), PackedStringArray(), "boot after the update reboot")
	var polls: int = realtime._poll_count
	await UnitTestCore.wait_frames(2)
	assert_gt(realtime._poll_count, polls, "RealtimeCore polls the fake realtime transport after the update reboot")
	await _release_modules(sender)
