extends UnitTestCase
## Event latches and frame waits.


func _start_events() -> bool:
	var started: bool = LogCore.init() and EventCore.init()
	assert_true(started, "LogCore and EventCore init")
	return started


func _publish_quit() -> void:
	var event: AppQuitEvent = EventCore.acquire(AppQuitEvent) as AppQuitEvent
	if event != null:
		EventCore.publish(event)


func test_wait_after_the_event_ends_at_once_with_already_true() -> void:
	if not _start_events():
		return
	var latch: UnitTestLatch = UnitTestCore.latch_event(AppQuitEvent)
	_publish_quit()
	var frame: int = Engine.get_process_frames()
	assert_true(await UnitTestCore.wait_latch(latch), "already came")
	assert_eq(Engine.get_process_frames(), frame, "no frame passed")


func test_wait_before_the_event_ends_after_it_with_already_false() -> void:
	if not _start_events():
		return
	var latch: UnitTestLatch = UnitTestCore.latch_event(AppQuitEvent)
	_publish_quit.call_deferred()
	assert_false(await UnitTestCore.wait_latch(latch), "came during the wait")
	assert_true(latch.happened)


func test_latch_made_before_event_core_init_catches_the_event() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	var latch: UnitTestLatch = UnitTestCore.latch_event(AppQuitEvent)
	assert_true(EventCore.init(), "EventCore.init")
	await get_tree().process_frame
	_publish_quit()
	assert_true(latch.happened, "subscribed after EventCore init")


## The init listener of `EventCoreDev` subscribes the latch inside `EventCore.init`: no node added after it and no frame
## are needed.
func test_latch_made_before_event_core_init_catches_the_event_of_the_same_call() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	var latch: UnitTestLatch = UnitTestCore.latch_event(AppQuitEvent)
	assert_true(EventCore.init(), "EventCore.init")
	_publish_quit()
	assert_true(latch.happened, "subscribed when EventCore init ended")
	assert_true(await UnitTestCore.wait_latch(latch), "already came")


func test_latch_subscribes_again_after_event_core_init_again() -> void:
	if not _start_events():
		return
	var latch: UnitTestLatch = UnitTestCore.latch_event(AppQuitEvent)
	EventCore.release()
	assert_true(EventCore.init(), "EventCore.init again")
	_publish_quit()
	assert_true(latch.happened, "subscribed again")


func test_wait_frames_waits_that_many_frames() -> void:
	var frame: int = Engine.get_process_frames()
	await UnitTestCore.wait_frames(3)
	assert_eq(Engine.get_process_frames(), frame + 3)


func test_latch_catches_the_event_of_the_call_that_inits_event_core_again() -> void:
	if not _start_events():
		return
	var latch: UnitTestLatch = UnitTestCore.latch_event(AppQuitEvent)
	EventCore.release()
	# As a boot does in one call: `EventCore` and a module after it `init`, then the event, with no frame between.
	assert_true(EventCore.init() and TimeCore.init(), "EventCore and TimeCore init again")
	_publish_quit()
	assert_true(latch.happened, "subscribed before the event of the same call")
	assert_true(await UnitTestCore.wait_latch(latch), "already came")


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


## `release` of `EventCore` before the boot clears the registration the latch made: the test boot registers again.
func test_test_boot_registers_the_init_listener_again() -> void:
	var booted: UnitTestLatch = UnitTestCore.latch_event(BootCompletedEvent)
	EventCore.release()
	# An `init` with no init listener left does not subscribe the latch.
	assert_true(EventCore.init(), "EventCore init")
	assert_eq(EventCore.count_subscriptions(booted), 0, "release cleared the registration of the latch")
	EventCore.release()
	UnitTestCore.start_test_boot(ContentEntry.new(), _boot_modules())
	await UnitTestCore.wait_latch(booted)
	assert_true(booted.happened, "the latch caught the end of the test boot")
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE, "boot done")


## The reverse release of a restart clears the init listener with `EventCore`: UnitTestCore registers it again before
## the `EventCore` init of the new boot, so a latch made after the first boot catches the event of the new boot. A
## registration after that init would leave the latch unsubscribed.
func test_restart_registers_the_init_listener_before_init_modules() -> void:
	var booted: UnitTestLatch = UnitTestCore.latch_event(BootCompletedEvent)
	UnitTestCore.start_test_boot(ContentEntry.new(), _boot_modules())
	await UnitTestCore.wait_latch(booted)
	assert_true(booted.happened, "the latch made before the first boot caught its end")
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE, "first boot done")
	var restarted: UnitTestLatch = UnitTestCore.latch_event(BootCompletedEvent)
	assert_eq(EventCore.count_subscriptions(restarted), 1, "subscribed at once while EventCore is initialized")
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(restarted)
	assert_true(restarted.happened, "the latch caught the end of the boot after the restart")
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE, "boot after the restart done")
