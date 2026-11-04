extends UnitTestCase
## The real push adapters PushCore receives: the APNs adapter of `ios` and the FCM adapter of `android`. PushCore gets
## the device token and the remote pushes through them. Picking them by build info `adapters` is `BootstrapCore`'s,
## so these tests pass the adapters as `BootstrapCore` would. A scripted plugin singleton stands in for the
## `ogw-push-apns` and `ogw-push-fcm` plugins a headless run does not have; without it the adapter gives no
## device token and no launch push.

const Env := preload("res://core/push_core/tests/support/push_test_env.gd")
const Plugin := preload("res://core/push_core/tests/support/scripted_push_plugin.gd")
const Recorder := preload("res://core/push_core/tests/support/push_event_recorder.gd")
const NotificationPlugin := preload("res://core/push_core/tests/support/scripted_notification_plugin.gd")

const _APNS_SINGLETON: String = "OgwPushApns"
const _FCM_SINGLETON: String = "OgwPushFcm"
const _NOTIFICATION_SINGLETON: String = "OgwNotification"

var _singleton: String = ""
var _plugin: Plugin = null
var _recorder: Recorder = null
var _notification_plugin: NotificationPlugin = null


func after_each() -> void:
	super()
	if _recorder != null:
		_recorder.finish()
		_recorder = null
	Env.stop()
	_drop_plugin()
	_drop_notification_plugin()


func _register_plugin(singleton: String) -> Plugin:
	_drop_plugin()
	_plugin = Plugin.new()
	_singleton = singleton
	Engine.register_singleton(singleton, _plugin)
	return _plugin


## Unregisters and frees the scripted plugin singleton.
func _drop_plugin() -> void:
	if not _singleton.is_empty() and Engine.has_singleton(_singleton):
		Engine.unregister_singleton(_singleton)
	_singleton = ""
	if _plugin != null:
		_plugin.free()
		_plugin = null


## Registers a scripted `ogw-notification` plugin whose permission reads end with `read_state`.
func _register_notification_plugin(read_state: int) -> NotificationPlugin:
	_drop_notification_plugin()
	_notification_plugin = NotificationPlugin.new()
	_notification_plugin.read_state = read_state
	Engine.register_singleton(_NOTIFICATION_SINGLETON, _notification_plugin)
	return _notification_plugin


func _drop_notification_plugin() -> void:
	if Engine.has_singleton(_NOTIFICATION_SINGLETON):
		Engine.unregister_singleton(_NOTIFICATION_SINGLETON)
	if _notification_plugin != null:
		_notification_plugin.free()
		_notification_plugin = null


func _record() -> void:
	_recorder = Recorder.new()
	assert_true(_recorder.start())


## Logs in and checks `RegisterPushToken` carries the plugin token, then the token change, the remote pushes and the
## launch push of the plugin.
func _check_token_and_remote_push(push: PushAdapter, plugin: Plugin, token: String) -> void:
	assert_true(PushCore._push == push)
	_record()
	Env.respond_register()
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(plugin.token_requests, 1)
	var sent: Array[CoreContract.RegisterPushTokenRequest] = Env.register_requests()
	assert_eq(sent.size(), 1)
	if sent.size() == 1:
		assert_eq(sent[0].device_token, token)
		assert_eq(sent[0].language, "en")
		assert_eq(sent[0].timezone_offset_ms, Env.timezone_offset_ms())
	Env.respond_register()
	plugin.change_token(token + "-2")
	await Env.settle()
	sent = Env.register_requests()
	assert_eq(sent.size(), 2, "the token change registers again")
	if sent.size() == 2:
		assert_eq(sent[1].device_token, token + "-2")
	plugin.receive(61)
	plugin.open(62)
	plugin.receive(63)
	await UnitTestCore.wait_frames(2)
	assert_eq(_recorder.received, PackedInt64Array([61, 63]))
	assert_eq(_recorder.opened, PackedInt64Array([62]))
	assert_eq(Env.errors(), 0)


func test_ios_apns_adapter_gives_the_device_token_and_the_remote_pushes() -> void:
	var plugin: Plugin = _register_plugin(_APNS_SINGLETON)
	plugin.token = "apns-token"
	var push: PushApnsAdapter = PushApnsAdapter.new()
	assert_true(push is PushAdapter)
	assert_true(await Env.start(push, NativeNotificationAdapter.new(), "ios"))
	await _check_token_and_remote_push(push, plugin, "apns-token")


func test_android_fcm_adapter_gives_the_device_token_and_the_remote_pushes() -> void:
	var plugin: Plugin = _register_plugin(_FCM_SINGLETON)
	plugin.token = "fcm-token"
	var push: PushFcmAdapter = PushFcmAdapter.new()
	assert_true(push is PushAdapter)
	assert_true(await Env.start(push, NativeNotificationAdapter.new(), "android"))
	await _check_token_and_remote_push(push, plugin, "fcm-token")


func test_apns_and_fcm_adapters_give_the_launch_push_once() -> void:
	var apns: Plugin = _register_plugin(_APNS_SINGLETON)
	apns.launch_push = 71
	assert_true(await Env.start(PushApnsAdapter.new(), NativeNotificationAdapter.new(), "ios"))
	assert_eq(PushCore.take_launch_push(), 71)
	assert_eq(PushCore.take_launch_push(), 0)
	Env.stop()
	var fcm: Plugin = _register_plugin(_FCM_SINGLETON)
	fcm.launch_push = 72
	assert_true(await Env.start(PushFcmAdapter.new(), NativeNotificationAdapter.new(), "android"))
	assert_eq(PushCore.take_launch_push(), 72)
	assert_eq(PushCore.take_launch_push(), 0)


func test_ios_apns_adapter_without_its_plugin_gives_no_token_and_no_launch_push() -> void:
	assert_false(Engine.has_singleton(_APNS_SINGLETON))
	var push: PushApnsAdapter = PushApnsAdapter.new()
	assert_true(await Env.start(push, NativeNotificationAdapter.new(), "ios"))
	assert_true(PushCore._push == push)
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 0, "no plugin, no device token")
	assert_eq(PushCore.take_launch_push(), 0)
	assert_eq(Env.errors(), 0)


func test_android_fcm_adapter_without_its_plugin_gives_no_token_and_no_launch_push() -> void:
	assert_false(Engine.has_singleton(_FCM_SINGLETON))
	var push: PushFcmAdapter = PushFcmAdapter.new()
	assert_true(await Env.start(push, NativeNotificationAdapter.new(), "android"))
	assert_true(PushCore._push == push)
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(Env.request_count(Env.REGISTER), 0, "no plugin, no device token")
	assert_eq(PushCore.take_launch_push(), 0)
	assert_eq(Env.errors(), 0)


func test_native_notification_adapter_gives_the_permission_the_plugin_read() -> void:
	var states: PackedInt32Array = [1, 2, 1, 2]
	var expected: Array[PushCore.PermissionStatus] = [
		PushCore.PermissionStatus.GRANTED,
		PushCore.PermissionStatus.DENIED,
		PushCore.PermissionStatus.GRANTED,
		PushCore.PermissionStatus.DENIED,
	]
	var platforms: PackedStringArray = ["android", "android", "ios", "ios"]
	for i: int in states.size():
		var plugin: NotificationPlugin = _register_notification_plugin(states[i])
		assert_true(await Env.start(null, NativeNotificationAdapter.new(), platforms[i]))
		await UnitTestCore.wait_frames(2)
		assert_eq(PushCore.get_permission(), expected[i], "the read of init, plugin state %d" % states[i])
		assert_eq(await PushCore.request_permission(), expected[i], "plugin state %d" % states[i])
		assert_eq(plugin.requests.size(), 0, "a read that is not undetermined opens no screen")
		assert_eq(plugin.cancelled.size(), 0)
		assert_eq(Env.errors(), 0)
		Env.stop()


func test_native_notification_adapter_gives_the_result_of_the_plugin_request_screen() -> void:
	var plugin: NotificationPlugin = _register_notification_plugin(0)
	assert_true(await Env.start(null, NativeNotificationAdapter.new(), "android"))
	await UnitTestCore.wait_frames(2)
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.UNDETERMINED, "plugin state 0")
	var states: PackedInt32Array = [1, 2, 0]
	var expected: Array[PushCore.PermissionStatus] = [
		PushCore.PermissionStatus.GRANTED,
		PushCore.PermissionStatus.DENIED,
		PushCore.PermissionStatus.UNDETERMINED,
	]
	for i: int in states.size():
		plugin.request_state = states[i]
		var requests: int = plugin.requests.size()
		assert_eq(await PushCore.request_permission(), expected[i], "screen state %d" % states[i])
		assert_eq(plugin.requests.size(), requests + 1, "the undetermined read opens the screen")
		assert_eq(PushCore.get_permission(), expected[i], "the screen result is cached")
	assert_eq(plugin.cancelled.size(), 0)
	assert_eq(Env.errors(), 0)


func test_native_notification_adapter_schedules_and_cancels_local_pushes_through_the_plugin() -> void:
	var plugin: NotificationPlugin = _register_notification_plugin(1)
	assert_true(await Env.start(null, NativeNotificationAdapter.new(), "ios"))
	await UnitTestCore.wait_frames(2)
	var return_id: int = Env.id_of(Env.RETURN_ROW)
	var event_id: int = Env.id_of(Env.EVENT_ROW)
	assert_true(PushCore.schedule_local(return_id))
	assert_true(PushCore.schedule_local_after(event_id, 5000))
	assert_eq(plugin.scheduled.size(), 2)
	if plugin.scheduled.size() == 2:
		_assert_scheduled(plugin.scheduled[0], return_id, "Come back", "Your rewards are waiting", Env.RETURN_DELAY_MS)
		_assert_scheduled(plugin.scheduled[1], event_id, "Event starts", "The event is open", 5000)
	PushCore.cancel_local(return_id)
	assert_eq(plugin.cancelled_local, PackedInt64Array([return_id]))
	PushCore.cancel_all_local()
	assert_eq(plugin.cancel_all_calls, 1)
	assert_eq(Env.errors(), 0)
	plugin.schedule_result = false
	assert_false(PushCore.schedule_local(return_id), "the plugin could not schedule")
	assert_eq(plugin.scheduled.size(), 3)
	assert_eq(Env.errors(), 1)


func _assert_scheduled(
	call: NotificationPlugin.Scheduled, id: int, title: String, body: String, delay_ms: int
) -> void:
	assert_eq(call.id, id)
	assert_eq(call.title, title)
	assert_eq(call.body, body)
	assert_eq(call.delay_ms, delay_ms)
