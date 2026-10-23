extends UnitTestCase
## BootstrapCore restart, boot events from other modules, update reboot.

const _SUPPORT := preload("res://core/bootstrap_core/tests/support/boot_test_support.gd")
const _NETWORK := preload("res://core/bootstrap_core/tests/support/boot_test_network.gd")
const _ENTRY := preload("res://core/bootstrap_core/tests/support/boot_test_entry.gd")
const _SCENE := preload("res://core/bootstrap_core/tests/resources/boot_test_scene.gd")


func after_each() -> void:
	_SCENE.start_hook = Callable()
	super()


func _boot(entry: ContentEntry) -> void:
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(entry, _SUPPORT.modules())
	await UnitTestCore.wait_latch(latch)


func _restart_and_wait() -> void:
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(latch)


static func _publish_restart_request() -> void:
	var event := EventCore.acquire(RestartRequestedEvent) as RestartRequestedEvent
	event.module = "BootTestCore"
	EventCore.publish(event)


static func _publish_fatal_request() -> void:
	var event := EventCore.acquire(FatalErrorRequestedEvent) as FatalErrorRequestedEvent
	event.module = "BootTestCore"
	event.reason = "test failure"
	EventCore.publish(event)


func _check_boot_events_once() -> void:
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_publish_restart_request()
	await UnitTestCore.wait_latch(latch)
	assert_eq(_SUPPORT.count("content.content_release"), 1)
	BootstrapCore._trace.clear()
	_publish_fatal_request()
	await UnitTestCore.wait_frames(3)
	assert_eq(_SUPPORT.popups().size(), 1)
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)


func test_boot_events_from_other_modules_are_handled_once_in_every_boot() -> void:
	_SUPPORT.prepare()
	await _boot(_ENTRY.new())
	BootstrapCore._trace.clear()
	await _check_boot_events_once()

	await _restart_and_wait()
	BootstrapCore._trace.clear()
	await _check_boot_events_once()

	BootstrapCore._test_downloads = _SUPPORT.bundle_downloads()
	await _restart_and_wait()
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)
	BootstrapCore._trace.clear()
	await _check_boot_events_once()

	var event := EventCore.acquire(ExitConfirmedEvent) as ExitConfirmedEvent
	EventCore.publish(event)
	assert_eq(BootstrapCore._quit_request_count, 1)
	assert_eq(_SUPPORT.count("EventCore.publish(AppQuitEvent)"), 1)


func test_restarts_in_one_frame_release_once_and_not_before_the_call_returns() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	await _boot(entry)
	BootstrapCore._trace.clear()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	assert_eq(_SUPPORT.count("LogCore.release"), 0)
	_publish_restart_request()
	BootstrapCore.request_restart()
	assert_eq(_SUPPORT.count("LogCore.release"), 0)
	await UnitTestCore.wait_latch(latch)
	await UnitTestCore.wait_frames(2)
	assert_eq(_SUPPORT.count("LogCore.release"), 1)
	assert_eq(entry.release_count, 1)
	assert_eq(_SUPPORT.count("stage:InitModules"), 1)


func test_restart_with_blocks_of_request_popup_and_black_box_leaves_no_error_log() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	_NETWORK.add_dev_login_success()
	_NETWORK.add_dev_login_success()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules(PackedStringArray(["AuthCore"])))
	await UnitTestCore.wait_latch(latch)
	UnitTestCore.add_pending("RunCoreTest")
	NetworkCore.send(GameContract.RunCoreTestRequest.new())
	var param := SystemPopupParam.new()
	param.body = ReservedString.bootstrap_fatal_error()
	var button := SystemPopupButton.new()
	button.label = ReservedString.bootstrap_restart()
	param.buttons.append(button)
	UICore.open_system_popup(param, Callable())
	MessageCore.show_black_box(ReservedString.bootstrap_restart())
	await UnitTestCore.wait_frames(1)
	assert_true(InputBlockCore.is_blocked())
	await _restart_and_wait()
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_false(InputBlockCore.is_blocked())
	assert_eq(UnitTestCore.cancel_count(), 1)


func test_restart_calls_content_init_again_and_hook_is_registered_once() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	entry.register_hook = true
	await _boot(entry)
	await _restart_and_wait()
	assert_eq(entry.init_count, 2)
	assert_eq(entry.register_results, [true, true] as Array[bool])
	assert_eq(UnitTestCore.check_logs("error", "NetworkCore"), 0)


## `BootCompletedEvent.duration_ms` of the boot after a restart counts from the start of that boot, not of the
## first boot: the real time between the two boots is left out.
func test_boot_completed_duration_after_restart_counts_only_the_new_boot() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	entry.record_boot_durations = true
	var first_started := Time.get_ticks_msec()
	await _boot(entry)
	var first_done := Time.get_ticks_msec()
	OS.delay_msec(300)
	var restarted := Time.get_ticks_msec()
	await _restart_and_wait()
	var second_done := Time.get_ticks_msec()
	# The latch resumes the test inside the publish of the event, before the entry gets it.
	await UnitTestCore.wait_frames(1)
	assert_eq(entry.boot_durations.size(), 2)
	if entry.boot_durations.size() == 2:
		assert_between(entry.boot_durations[0], 0, first_done - first_started)
		assert_between(entry.boot_durations[1], 0, second_done - restarted)


func test_update_reboot_releases_modules_without_content_release() -> void:
	_SUPPORT.prepare()
	BootstrapCore._test_downloads = _SUPPORT.bundle_downloads()
	var entry := _ENTRY.new()
	await _boot(entry)
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)
	assert_eq(entry.release_count, 0)
	assert_eq(_SUPPORT.count("LogCore.release"), 1)
	assert_eq(entry.init_count, 1)


func test_restart_in_title_scene_releases_modules_without_content_release() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SCENE.start_hook = func(key: String) -> void:
		if key == _SUPPORT.TITLE_KEY and _SUPPORT.count("stage:InitModules") == 1:
			BootstrapCore.request_restart()
	_SUPPORT.start(entry, _SUPPORT.modules())
	await UnitTestCore.wait_latch(latch)
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)
	assert_eq(entry.release_count, 0)
	assert_eq(_SUPPORT.count("LogCore.release"), 1)
	assert_eq(entry.init_count, 1)

