extends UnitTestCase
## The real push adapter and notification adapter over plugin singletons that never answer: a device token request
## ends at `PushCore.deviceTokenTimeoutMs`, a permission read at `PushCore.permissionReadTimeoutMs`, a permission
## request waits for the user with no time limit, and `release` ends them all.
## When an adapter stops waiting it stops reading the plugin and tells the plugin.

const Env := preload("res://core/push_core/tests/support/push_test_env.gd")
const PushPlugin := preload("res://core/push_core/tests/support/scripted_push_plugin.gd")
const NotificationPlugin := preload("res://core/push_core/tests/support/silent_notification_plugin.gd")

const _FCM_SINGLETON: String = "OgwPushFcm"
const _NOTIFICATION_SINGLETON: String = "OgwNotification"
const _TIMEOUT_MS: int = 3000
const _READ_TIMEOUT_MS: int = 2000

var _push_plugin: PushPlugin = null
var _notification_plugin: NotificationPlugin = null


func after_each() -> void:
	super()
	Env.stop()
	var singletons: PackedStringArray = [_FCM_SINGLETON, _NOTIFICATION_SINGLETON]
	for singleton: String in singletons:
		if Engine.has_singleton(singleton):
			Engine.unregister_singleton(singleton)
	if _push_plugin != null:
		_push_plugin.free()
		_push_plugin = null
	if _notification_plugin != null:
		_notification_plugin.free()
		_notification_plugin = null


## Registers a push plugin whose token requests never end and starts PushCore with the FCM adapter.
func _start_silent_push() -> bool:
	assert_true(UnitTestCore.set_test_settings("PushCore.deviceTokenTimeoutMs", _TIMEOUT_MS))
	_push_plugin = PushPlugin.new()
	_push_plugin.token_frames = 1 << 30
	Engine.register_singleton(_FCM_SINGLETON, _push_plugin)
	return await Env.start(PushFcmAdapter.new(), null, "android")


## `token_state` calls stay the same over a few frames.
func _push_reads_stopped() -> bool:
	var polls: int = _push_plugin.token_polls
	await UnitTestCore.wait_frames(4)
	return polls > 0 and _push_plugin.token_polls == polls


func test_a_token_request_that_never_ends_stops_at_the_time_limit() -> void:
	assert_true(await _start_silent_push())
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(_push_plugin.token_requests, 1)
	UnitTestCore.advance_clock(_TIMEOUT_MS - 1, false)
	await UnitTestCore.wait_frames(2)
	assert_eq(_push_plugin.cancelled.size(), 0, "not before the time limit")
	UnitTestCore.advance_clock(1, false)
	await UnitTestCore.wait_frames(2)
	assert_eq(_push_plugin.cancelled, PackedInt64Array([1]), "the plugin is told once")
	assert_true(await _push_reads_stopped(), "the adapter stops reading the plugin")
	assert_eq(Env.request_count(Env.REGISTER), 0)
	assert_eq(Env.errors(), 0)


func test_release_ends_a_token_request_that_never_ends() -> void:
	assert_true(await _start_silent_push())
	assert_true(await Env.login())
	await Env.settle()
	assert_eq(_push_plugin.token_requests, 1)
	PushCore.release()
	await UnitTestCore.wait_frames(2)
	assert_eq(_push_plugin.cancelled, PackedInt64Array([1]))
	assert_true(await _push_reads_stopped())


## Registers a notification plugin whose permission operations never end and starts PushCore with the native
## notification adapter. `init` starts the first permission read.
func _start_silent_notification() -> bool:
	assert_true(UnitTestCore.set_test_settings("PushCore.permissionReadTimeoutMs", _READ_TIMEOUT_MS))
	_notification_plugin = NotificationPlugin.new()
	Engine.register_singleton(_NOTIFICATION_SINGLETON, _notification_plugin)
	var notification: NativeNotificationAdapter = NativeNotificationAdapter.new()
	if not await Env.start(null, notification, "android"):
		return false
	assert_eq(notification.permission_read_timeout_ms, _READ_TIMEOUT_MS, "init sets the adapter time limit")
	return true


## `permission_state` calls stay the same over a few frames.
func _notification_reads_stopped() -> bool:
	var polls: int = _notification_plugin.polls
	await UnitTestCore.wait_frames(4)
	return polls > 0 and _notification_plugin.polls == polls


func test_a_permission_read_that_never_ends_is_undetermined_at_the_time_limit() -> void:
	assert_true(await _start_silent_notification())
	assert_eq(_notification_plugin.started, PackedInt64Array([1]), "init reads the permission")
	UnitTestCore.advance_clock(_READ_TIMEOUT_MS - 1, false)
	await UnitTestCore.wait_frames(2)
	assert_eq(_notification_plugin.cancelled.size(), 0, "not before the time limit")
	UnitTestCore.advance_clock(1, false)
	await UnitTestCore.wait_frames(2)
	assert_eq(_notification_plugin.cancelled, PackedInt64Array([1]), "the plugin is told once")
	assert_true(await _notification_reads_stopped(), "the adapter stops reading the plugin")
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.UNDETERMINED)
	assert_eq(Env.errors(), 0)


func test_the_permission_request_waits_with_no_time_limit_after_its_read_times_out() -> void:
	assert_true(await _start_silent_notification())
	var request: Array[PushCore.PermissionStatus] = []
	var job: Callable = func() -> void:
		request.append(await PushCore.request_permission())
	job.call()
	await UnitTestCore.wait_frames(2)
	assert_eq(_notification_plugin.started, PackedInt64Array([1, 2]), "init and request_permission read first")
	assert_eq(_notification_plugin.requests.size(), 0)
	UnitTestCore.advance_clock(_READ_TIMEOUT_MS, false)
	await UnitTestCore.wait_frames(3)
	var cancelled: PackedInt64Array = _notification_plugin.cancelled.duplicate()
	cancelled.sort()
	assert_eq(cancelled, PackedInt64Array([1, 2]), "both reads end at the time limit")
	assert_eq(_notification_plugin.requests, PackedInt64Array([3]), "the Undetermined read opens the request screen")
	UnitTestCore.advance_clock(_READ_TIMEOUT_MS * 10, false)
	await UnitTestCore.wait_frames(2)
	assert_eq(request.size(), 0, "the request waits for the user with no time limit")
	assert_eq(_notification_plugin.cancelled.size(), 2)
	PushCore.release()
	await UnitTestCore.wait_frames(2)
	assert_eq(request.size(), 1, "release ends the request")
	if request.size() == 1:
		assert_eq(request[0], PushCore.PermissionStatus.UNDETERMINED)
	var told: PackedInt64Array = _notification_plugin.cancelled.slice(2)
	assert_eq(told, PackedInt64Array([3]), "the request is told once")
	assert_true(await _notification_reads_stopped(), "the adapter stops reading the plugin")
