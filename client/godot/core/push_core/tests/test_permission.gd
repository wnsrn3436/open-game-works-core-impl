extends UnitTestCase
## Notification permission: the cache, its reads at `init` and at the return from the background, `request_permission`,
## no notification adapter, and platform `web`.

const Env := preload("res://core/push_core/tests/support/push_test_env.gd")
const TestNotification := preload("res://core/push_core/tests/support/scripted_notification_adapter.gd")


func after_each() -> void:
	super()
	Env.stop()


func test_permission_is_undetermined_before_the_first_read_and_follows_the_os_at_the_foreground_return() -> void:
	assert_true(await Env.start(null, FakeNotificationAdapter.new()))
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.UNDETERMINED, "before the first read ends")
	await UnitTestCore.wait_frames(2)
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.GRANTED)
	PushCoreDev.set_fake_permission(PushCore.PermissionStatus.DENIED)
	await UnitTestCore.wait_frames(2)
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.GRANTED, "before the return from the background")
	UnitTestCore.advance_clock(1000, true)
	await UnitTestCore.wait_frames(2)
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.DENIED, "after the return from the background")


func test_get_permission_reads_the_cache_not_the_os() -> void:
	var adapter: TestNotification = TestNotification.new()
	assert_true(await Env.start(null, adapter))
	assert_eq(adapter.read_calls, 1, "the read of init")
	for i: int in 3:
		assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.GRANTED)
	assert_eq(adapter.read_calls, 1)


func test_request_permission_returns_the_read_value_without_a_screen_when_it_is_not_undetermined() -> void:
	var adapter: TestNotification = TestNotification.new()
	adapter.permission = PushCore.PermissionStatus.DENIED
	adapter.request_result = PushCore.PermissionStatus.GRANTED
	assert_true(await Env.start(null, adapter))
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.DENIED)
	assert_eq(adapter.request_calls, 0)
	adapter.permission = PushCore.PermissionStatus.GRANTED
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.GRANTED)
	assert_eq(adapter.request_calls, 0)
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.GRANTED, "the read value is cached")
	assert_eq(Env.errors(), 0)


func test_request_permission_shows_the_os_screen_when_undetermined_and_caches_its_result() -> void:
	var adapter: TestNotification = TestNotification.new()
	adapter.permission = PushCore.PermissionStatus.UNDETERMINED
	adapter.request_result = PushCore.PermissionStatus.DENIED
	assert_true(await Env.start(null, adapter))
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.UNDETERMINED)
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.DENIED)
	assert_eq(adapter.request_calls, 1)
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.DENIED)


func test_without_notification_adapter_permission_is_unsupported_and_schedule_is_false_without_a_log() -> void:
	assert_true(await Env.start(null, null))
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.UNSUPPORTED)
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.UNSUPPORTED)
	assert_false(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	assert_false(PushCore.schedule_local_after(Env.id_of(Env.EVENT_ROW), 1000))
	UnitTestCore.advance_clock(1000, true)
	await UnitTestCore.wait_frames(2)
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.UNSUPPORTED)
	assert_eq(Env.errors(), 0)


func test_web_ignores_the_fake_notification_adapter() -> void:
	assert_true(await Env.start(null, FakeNotificationAdapter.new(), "web"))
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.UNSUPPORTED)
	await UnitTestCore.wait_frames(2)
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.UNSUPPORTED)
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.UNSUPPORTED)
	assert_false(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	var buffer: Array[ScheduledLocalPush] = []
	buffer.resize(2)
	assert_eq(PushCoreDev.list_scheduled_local(buffer), 0, "nothing went to the OS")
	assert_eq(Env.errors(), 0)


func test_web_calls_no_notification_adapter_operation() -> void:
	var adapter: TestNotification = TestNotification.new()
	adapter.permission = PushCore.PermissionStatus.UNDETERMINED
	assert_true(await Env.start(null, adapter, "web"))
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.UNSUPPORTED)
	assert_false(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	PushCore.cancel_local(Env.id_of(Env.RETURN_ROW))
	PushCore.cancel_all_local()
	UnitTestCore.advance_clock(1000, true)
	await UnitTestCore.wait_frames(2)
	assert_eq(adapter.read_calls, 0)
	assert_eq(adapter.request_calls, 0, "no permission request screen")
	assert_eq(adapter.scheduled.size(), 0)
	assert_eq(adapter.cancel_all_calls, 0)
	assert_eq(adapter.cancelled.size(), 0)


func test_fake_permission_status_outside_the_enum_is_an_error_and_is_ignored() -> void:
	assert_true(await Env.start(null, FakeNotificationAdapter.new()))
	PushCoreDev.set_fake_permission(9 as PushCore.PermissionStatus)
	assert_eq(Env.errors(), 1)
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.GRANTED)
