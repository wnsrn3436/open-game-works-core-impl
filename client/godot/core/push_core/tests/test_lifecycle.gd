extends UnitTestCase
## PushCore lifecycle: init check, the state `release` keeps and clears, calls before `init`, adapters after `init`.

const Env := preload("res://core/push_core/tests/support/push_test_env.gd")
const TestPush := preload("res://core/push_core/tests/support/scripted_push_adapter.gd")
const TestNotification := preload("res://core/push_core/tests/support/scripted_notification_adapter.gd")


func after_each() -> void:
	super()
	Env.stop()


func test_init_check_follows_init_and_release() -> void:
	assert_false(PushCore.is_initialized())
	assert_true(await Env.start(TestPush.new(), TestNotification.new()))
	assert_true(PushCore.is_initialized())
	PushCore.release()
	assert_false(PushCore.is_initialized())
	assert_true(Env.start_push(TestPush.new(), TestNotification.new()))
	assert_true(PushCore.is_initialized())
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.GRANTED)


func test_second_init_fails_with_an_error() -> void:
	assert_true(await Env.start(null, null))
	assert_false(PushCore.init())
	assert_eq(Env.errors(), 1)
	assert_true(PushCore.is_initialized())


func test_release_clears_the_state_and_removes_the_core_node() -> void:
	UnitTestCore.set_test_settings("PushCore.deviceTokenTimeoutMs", 5000)
	var push: TestPush = TestPush.new()
	push.hold = true
	assert_true(await Env.start(push, FakeNotificationAdapter.new()))
	await UnitTestCore.wait_frames(2)
	PushCoreDev.set_fake_permission(PushCore.PermissionStatus.DENIED)
	PushCoreDev.set_fake_schedule_result(false)
	assert_true(await Env.login())
	assert_eq(PushCore._token_waits.size(), 1, "a held device token request")
	var node: Node = PushCore._node
	PushCore.release()
	await UnitTestCore.wait_frames(2)
	assert_false(is_instance_valid(node))
	assert_false(PushCore._is_initialized)
	assert_null(PushCore._life)
	assert_null(PushCore._node)
	assert_null(PushCore._push)
	assert_null(PushCore._notification)
	assert_null(PushCore._active_notification)
	assert_eq(PushCore._permission, PushCore.PermissionStatus.UNDETERMINED)
	assert_eq(PushCore._read_serial, 0)
	assert_eq(PushCore._token_waits.size(), 0)
	assert_eq(PushCore._token_timeout_ms, 0)
	assert_false(PushCore._register_failed_call.is_valid())
	assert_false(push.on_token_changed.is_valid(), "the dropped push adapter tells PushCore nothing")
	assert_false(push.on_push_received.is_valid())
	assert_false(push.on_push_opened.is_valid())
	push.give_token("after-release")
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 0, "the stopped token request registers nothing")
	assert_true(Env.start_push(null, FakeNotificationAdapter.new()))
	await UnitTestCore.wait_frames(2)
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.GRANTED, "the fake permission set before release is gone")
	assert_true(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)), "the fake schedule result set before release is gone")


func test_release_keeps_the_local_push_schedules_and_the_launch_push() -> void:
	assert_true(await Env.start(FakePushAdapter.new(), FakeNotificationAdapter.new()))
	await UnitTestCore.wait_frames(2)
	assert_true(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	PushCoreDev.set_fake_launch_push(77)
	PushCore.release()
	assert_true(Env.start_push(FakePushAdapter.new(), FakeNotificationAdapter.new()))
	var buffer: Array[ScheduledLocalPush] = []
	buffer.resize(4)
	assert_eq(PushCoreDev.list_scheduled_local(buffer), 1)
	assert_eq(buffer[0].id, Env.id_of(Env.RETURN_ROW))
	assert_eq(PushCore.take_launch_push(), 77)


func test_core_node_freed_outside_release_cleans_up_without_errors() -> void:
	assert_true(await Env.start(TestPush.new(), TestNotification.new()))
	var node: Node = PushCore._node
	node.get_parent().remove_child(node)
	node.free()
	assert_false(PushCore.is_initialized())
	assert_null(PushCore._node)
	assert_null(PushCore._push)
	assert_true(Env.start_push(TestPush.new(), TestNotification.new()))
	assert_true(PushCore.is_initialized())


func test_calls_before_init_log_and_return_the_failure_value() -> void:
	assert_true(await Env.start_dependencies())
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.UNDETERMINED)
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.UNDETERMINED)
	assert_false(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	assert_false(PushCore.schedule_local_after(Env.id_of(Env.EVENT_ROW), 1000))
	PushCore.cancel_local(Env.id_of(Env.RETURN_ROW))
	PushCore.cancel_all_local()
	assert_eq(PushCore.take_launch_push(), 0)
	var consent: PushConsentInfo = PushCore.get_push_consent()
	assert_eq(consent.push_ad, CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED)
	assert_eq(consent.push_night, CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED)
	assert_false(await PushCore.set_push_consent(CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED, CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED))
	assert_eq(Env.errors(), 9)
	PushCore.release()
	assert_eq(Env.errors(), 0, "release before init logs nothing")


func test_adapters_set_after_init_are_ignored_with_an_error() -> void:
	var push: TestPush = TestPush.new()
	var notification: TestNotification = TestNotification.new()
	assert_true(await Env.start(push, notification))
	PushCore.set_push_adapter(TestPush.new())
	PushCore.set_notification_adapter(TestNotification.new())
	assert_eq(Env.errors(), 2)
	assert_true(PushCore._push == push)
	assert_true(PushCore._notification == notification)
