extends UnitTestCase
## The real push adapters PushCore receives: the APNs adapter of `ios` and the FCM adapter of `android`. PushCore gets
## the device token and the remote pushes through them. Picking them by build info `adapters` is `BootstrapCore`'s,
## so these tests pass the adapters as `BootstrapCore` would. A scripted plugin singleton stands in for the
## `ogw-push-apns` and `ogw-push-fcm` plugins a headless run does not have; without it the adapter gives no
## device token and no launch push.

const Env := preload("res://core/push_core/tests/support/push_test_env.gd")
const Plugin := preload("res://core/push_core/tests/support/scripted_push_plugin.gd")
const Recorder := preload("res://core/push_core/tests/support/push_event_recorder.gd")

const _APNS_SINGLETON: String = "OgwPushApns"
const _FCM_SINGLETON: String = "OgwPushFcm"

var _singleton: String = ""
var _plugin: Plugin = null
var _recorder: Recorder = null


func after_each() -> void:
	super()
	if _recorder != null:
		_recorder.finish()
		_recorder = null
	Env.stop()
	_drop_plugin()


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
