extends UnitTestCase
## Device token registration: `RegisterPushToken` at each login and token change, its content, the empty token, no
## push adapter, the device token time limit, and the fake push adapter token.

const Env := preload("res://core/push_core/tests/support/push_test_env.gd")
const TestPush := preload("res://core/push_core/tests/support/scripted_push_adapter.gd")
const TestNotification := preload("res://core/push_core/tests/support/scripted_notification_adapter.gd")

const _TIMEOUT_MS: int = 5000


func after_each() -> void:
	super()
	Env.stop()


func test_each_login_sends_one_register_push_token_with_the_language_code_and_the_time_zone_offset() -> void:
	var push: TestPush = TestPush.new()
	assert_true(await Env.start(push, TestNotification.new()))
	Env.respond_register()
	assert_true(await Env.login())
	await Env.settle()
	var sent: Array[CoreContract.RegisterPushTokenRequest] = Env.register_requests()
	assert_eq(sent.size(), 1)
	assert_eq(sent[0].device_token, "test-token-1")
	assert_eq(sent[0].language, LocalizationCore.get_language_code())
	assert_eq(sent[0].language, "en")
	assert_eq(sent[0].timezone_offset_ms, Env.timezone_offset_ms())
	Env.respond_register()
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(Env.register_requests().size(), 2, "the second login registers again")
	assert_eq(push.token_calls, 2)


func test_register_push_token_carries_the_language_code_after_a_language_change() -> void:
	var push: TestPush = TestPush.new()
	assert_true(await Env.start(push, TestNotification.new()))
	var row: GameData.LocalPushRow = GameData.LocalPushTable.get_row(Env.id_of(Env.RETURN_ROW))
	assert_true(await Env.restart_language("ca", PackedStringArray([row.title, "Torna"])))
	assert_eq(LocalizationCore.get_language_code(), "ca")
	Env.respond_register()
	assert_true(await Env.login())
	await Env.settle()
	Env.respond_register()
	push.change_token("test-token-2")
	await Env.settle()
	var sent: Array[CoreContract.RegisterPushTokenRequest] = Env.register_requests()
	assert_eq(sent.size(), 2)
	assert_eq(sent[0].language, "ca", "the login registration")
	assert_eq(sent[1].language, "ca", "the token change registration")


func test_token_change_with_a_session_registers_the_new_token() -> void:
	var push: TestPush = TestPush.new()
	assert_true(await Env.start(push, TestNotification.new()))
	Env.respond_register()
	assert_true(await Env.login())
	await Env.settle()
	Env.respond_register()
	push.change_token("test-token-2")
	await Env.settle()
	var sent: Array[CoreContract.RegisterPushTokenRequest] = Env.register_requests()
	assert_eq(sent.size(), 2)
	assert_eq(sent[1].device_token, "test-token-2")
	assert_eq(sent[1].language, "en")
	assert_eq(sent[1].timezone_offset_ms, Env.timezone_offset_ms())


func test_token_change_without_a_session_registers_nothing() -> void:
	var push: TestPush = TestPush.new()
	assert_true(await Env.start(push, TestNotification.new()))
	push.change_token("test-token-2")
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 0)


func test_empty_token_is_not_registered() -> void:
	var push: TestPush = TestPush.new()
	push.token = ""
	assert_true(await Env.start(push, TestNotification.new()))
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(push.token_calls, 1)
	push.change_token("")
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 0)


func test_no_push_adapter_sends_no_register_push_token() -> void:
	assert_true(await Env.start(null, TestNotification.new()))
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 0)


func test_notification_adapter_without_push_adapter_still_works() -> void:
	var notification: TestNotification = TestNotification.new()
	notification.permission = PushCore.PermissionStatus.UNDETERMINED
	notification.request_result = PushCore.PermissionStatus.GRANTED
	assert_true(await Env.start(null, notification))
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.GRANTED, "the notification adapter result")
	assert_eq(notification.request_calls, 1)
	assert_true(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	assert_eq(notification.scheduled.size(), 1)
	assert_eq(notification.scheduled[0].delay_ms, Env.RETURN_DELAY_MS)
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 0)


func test_token_not_given_within_the_time_limit_on_the_test_clock_is_not_registered() -> void:
	assert_true(UnitTestCore.set_test_settings("PushCore.deviceTokenTimeoutMs", _TIMEOUT_MS))
	var push: TestPush = TestPush.new()
	push.hold = true
	assert_true(await Env.start(push, TestNotification.new()))
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(push.token_calls, 1)
	UnitTestCore.advance_clock(_TIMEOUT_MS, false)
	await UnitTestCore.wait_frames(2)
	assert_eq(PushCore._token_waits.size(), 0, "the wait ended at the time limit")
	push.give_token("late-token")
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 0)


func test_token_time_limit_ends_the_wait_while_the_tree_is_paused() -> void:
	assert_true(UnitTestCore.set_test_settings("PushCore.deviceTokenTimeoutMs", _TIMEOUT_MS))
	var push: TestPush = TestPush.new()
	push.hold = true
	assert_true(await Env.start(push, TestNotification.new()))
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(PushCore._token_waits.size(), 1)
	TimeCore.set_paused(true)
	UnitTestCore.advance_clock(_TIMEOUT_MS, false)
	await UnitTestCore.wait_frames(2)
	assert_eq(PushCore._token_waits.size(), 0, "the wait ended at the time limit while paused")
	TimeCore.set_paused(false)
	push.give_token("late-token")
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 0)


func test_token_given_within_the_time_limit_on_the_test_clock_is_registered() -> void:
	assert_true(UnitTestCore.set_test_settings("PushCore.deviceTokenTimeoutMs", _TIMEOUT_MS))
	var push: TestPush = TestPush.new()
	push.hold = true
	assert_true(await Env.start(push, TestNotification.new()))
	assert_true(await Env.login())
	await Env.settle()
	UnitTestCore.advance_clock(_TIMEOUT_MS - 1, false)
	await UnitTestCore.wait_frames(2)
	Env.respond_register()
	push.give_token("in-time-token")
	await Env.settle()
	var sent: Array[CoreContract.RegisterPushTokenRequest] = Env.register_requests()
	assert_eq(sent.size(), 1)
	assert_eq(sent[0].device_token, "in-time-token")


func test_register_failure_registers_again_at_the_next_login() -> void:
	var push: TestPush = TestPush.new()
	assert_true(await Env.start(push, TestNotification.new()))
	Env.respond_error(Env.REGISTER, CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST)
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 1)
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "a handled server error is a warn of NetworkCore")
	assert_eq(Env.errors(), 0)
	Env.respond_register()
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 2)


func test_fake_push_adapter_token_is_fake_install_id_on_android() -> void:
	await _check_fake_token("android")


func test_fake_push_adapter_token_is_fake_install_id_on_ios() -> void:
	await _check_fake_token("ios")


func _check_fake_token(platform: String) -> void:
	assert_true(await Env.start(FakePushAdapter.new(), TestNotification.new(), platform))
	Env.respond_register()
	assert_true(await Env.login())
	await Env.settle()
	Env.respond_register()
	assert_true(await Env.login())
	await Env.settle()
	var sent: Array[CoreContract.RegisterPushTokenRequest] = Env.register_requests()
	assert_eq(sent.size(), 2)
	var install_id: String = LocalDataCore.get_value_string(LocalDataCore.FileKind.DEVICE, "PushCore.install_id", "")
	assert_eq(install_id.length(), 36)
	assert_eq(install_id.substr(14, 1), "4", "UUID v4")
	assert_eq(sent[0].device_token, "fake:" + install_id)
	assert_eq(sent[1].device_token, sent[0].device_token, "the install ID stays")


func test_fake_push_adapter_has_no_token_on_other_platforms() -> void:
	assert_true(await Env.start(FakePushAdapter.new(), TestNotification.new(), "windows"))
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 0)
