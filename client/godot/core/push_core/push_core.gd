class_name PushCore
extends RefCounted
## Notification permission, the server registration of the push device token, local push schedules, the delivery of
## remote pushes, and the lookup and change of the ad push consent.

enum PermissionStatus { UNDETERMINED, GRANTED, DENIED, UNSUPPORTED }

const _TAG: String = "PushCore"
const _SETTING_TOKEN_TIMEOUT: String = "PushCore.deviceTokenTimeoutMs"
const _SETTING_PERMISSION_READ_TIMEOUT: String = "PushCore.permissionReadTimeoutMs"
const _WEB: String = "web"
const _MS_PER_MINUTE: int = 60000

const _NODE := preload("res://core/push_core/push_core_node.gd")
const _TOKEN_WAIT := preload("res://core/push_core/push_token_wait.gd")

static var _is_initialized: bool = false
## New object every `init`. An async operation that finds another object after an `await` stopped by `release`.
static var _life: RefCounted = null
static var _node: _NODE = null
## Adapters `set_push_adapter` and `set_notification_adapter` passed before `init`.
static var _push: PushAdapter = null
static var _notification: NotificationAdapter = null
## Notification adapter PushCore calls: `_notification`, except none on platform `web`.
static var _active_notification: NotificationAdapter = null
## Permission cache.
static var _permission: PermissionStatus = PermissionStatus.UNDETERMINED
## Number of the latest permission read. An older read that ends later leaves the cache alone.
static var _read_serial: int = 0
static var _token_waits: Array[_TOKEN_WAIT] = []
static var _token_timeout_ms: int = 0
static var _register_failed_call: Callable = Callable()


# --- lifecycle ---


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	var keys: PackedStringArray = [_SETTING_TOKEN_TIMEOUT, _SETTING_PERMISSION_READ_TIMEOUT]
	for key: String in keys:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init: setting %s is missing or not an integer" % key)
			return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init: no scene tree")
		return false
	_token_timeout_ms = CoreSettings.get_int(_SETTING_TOKEN_TIMEOUT)
	_life = RefCounted.new()
	_register_failed_call = PushCore._on_register_failed
	_active_notification = null if CoreBuildInfo.platform == _WEB else _notification
	_permission = PermissionStatus.UNDETERMINED if _active_notification != null else PermissionStatus.UNSUPPORTED
	_node = _NODE.new()
	_node.name = _TAG
	# The adapter notifications and the device token time limit go on while `TimeCore.set_paused` pauses the tree.
	_node.process_mode = Node.PROCESS_MODE_ALWAYS
	tree.root.add_child(_node)
	var subscribed: bool = (
		EventCore.subscribe(AppForegroundReturnedEvent, _node._on_app_foreground_returned)
		and EventCore.subscribe(LoginCompletedEvent, _node._on_login_completed)
		and EventCore.subscribe(SessionEndedEvent, _node._on_session_ended)
	)
	_is_initialized = true
	if not subscribed:
		LogCore.log_error(_TAG, "init: event subscription failed")
		release()
		return false
	if _push != null:
		_push.on_token_changed = PushCore._on_token_changed
		_push.on_push_received = PushCore._on_push_received
		_push.on_push_opened = PushCore._on_push_opened
		_push.token_timeout_ms = _token_timeout_ms
		_push.start()
	if _active_notification != null:
		_active_notification.permission_read_timeout_ms = CoreSettings.get_int(_SETTING_PERMISSION_READ_TIMEOUT)
		_active_notification.start()
	_read_permission()
	return true


static func release() -> void:
	if not _is_initialized:
		return
	_clean_up(true)


static func is_initialized() -> bool:
	return _is_initialized


static func _on_node_exit(node: Node) -> void:
	if _is_initialized and node == _node:
		_clean_up(false)


## `release`. `detach` is `false` when the core node leaves the tree by itself (app exit). The OS local push
## schedules and the launch push no one took stay.
static func _clean_up(detach: bool) -> void:
	_is_initialized = false
	_life = null
	var waits: Array[_TOKEN_WAIT] = _token_waits
	_token_waits = []
	for wait: _TOKEN_WAIT in waits:
		wait.finish("")
	if _push != null:
		_push.on_token_changed = Callable()
		_push.on_push_received = Callable()
		_push.on_push_opened = Callable()
		_push.stop()
	if _active_notification != null:
		_active_notification.stop()
	var node: _NODE = _node
	_node = null
	if node != null:
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		if detach and node.get_parent() != null:
			node.get_parent().remove_child(node)
		if not node.is_queued_for_deletion():
			node.queue_free()
	_push = null
	_notification = null
	_active_notification = null
	_permission = PermissionStatus.UNDETERMINED
	_read_serial = 0
	_token_timeout_ms = 0
	_register_failed_call = Callable()


static func _check(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, "%s: not initialized" % operation)
	return false


# --- before init ---


static func set_push_adapter(adapter: PushAdapter) -> void:
	if _is_initialized:
		LogCore.log_error(_TAG, "set_push_adapter: called after init; ignored")
		return
	_push = adapter


static func set_notification_adapter(adapter: NotificationAdapter) -> void:
	if _is_initialized:
		LogCore.log_error(_TAG, "set_notification_adapter: called after init; ignored")
		return
	_notification = adapter


# --- permission ---


static func get_permission() -> PermissionStatus:
	if not _check("get_permission"):
		return PermissionStatus.UNDETERMINED
	return _permission


static func request_permission() -> PermissionStatus:
	if not _check("request_permission"):
		return PermissionStatus.UNDETERMINED
	var adapter: NotificationAdapter = _active_notification
	if adapter == null:
		return PermissionStatus.UNSUPPORTED
	var life: RefCounted = _life
	_read_serial += 1
	var serial: int = _read_serial
	var status: PermissionStatus = _status_of(await adapter.read_permission(), "read_permission")
	if life != _life:
		return PermissionStatus.UNDETERMINED
	if status == PermissionStatus.UNDETERMINED:
		status = _status_of(await adapter.request_permission(), "request_permission")
		if life != _life:
			return PermissionStatus.UNDETERMINED
	if serial == _read_serial:
		_permission = status
	return status


## Reads the OS permission into the cache, at `init` and at each return from the background.
static func _read_permission() -> void:
	var adapter: NotificationAdapter = _active_notification
	if not _is_initialized or adapter == null:
		return
	var life: RefCounted = _life
	_read_serial += 1
	var serial: int = _read_serial
	var status: PermissionStatus = _status_of(await adapter.read_permission(), "read_permission")
	if life != _life or serial != _read_serial:
		return
	_permission = status


## A `PermissionStatus` from an adapter. A value outside the enum is `UNDETERMINED` with an error log.
static func _status_of(value: int, operation: String) -> PermissionStatus:
	if value < PermissionStatus.UNDETERMINED or value > PermissionStatus.UNSUPPORTED:
		LogCore.log_error(_TAG, "notification adapter %s returned %d, not a PermissionStatus" % [operation, value])
		return PermissionStatus.UNDETERMINED
	return value as PermissionStatus


# --- local push ---


static func schedule_local(local_push_id: int) -> bool:
	if not _check("schedule_local"):
		return false
	var row: GameData.LocalPushRow = _local_push_row("schedule_local", local_push_id)
	if row == null:
		return false
	if row.delay == 0:
		LogCore.log_error(_TAG, "schedule_local: local_push %d has a null delay" % local_push_id)
		return false
	return _schedule(row, row.delay)


static func schedule_local_after(local_push_id: int, delay_ms: int) -> bool:
	if not _check("schedule_local_after"):
		return false
	var row: GameData.LocalPushRow = _local_push_row("schedule_local_after", local_push_id)
	if row == null:
		return false
	if row.delay != 0:
		LogCore.log_error(_TAG, "schedule_local_after: local_push %d has a delay" % local_push_id)
		return false
	if delay_ms <= 0:
		LogCore.log_error(_TAG, "schedule_local_after: delay %d ms is not positive" % delay_ms)
		return false
	return _schedule(row, delay_ms)


static func cancel_local(local_push_id: int) -> void:
	if not _check("cancel_local"):
		return
	if _local_push_row("cancel_local", local_push_id) == null:
		return
	if _active_notification != null:
		_active_notification.cancel_local(local_push_id)


static func cancel_all_local() -> void:
	if not _check("cancel_all_local"):
		return
	if _active_notification != null:
		_active_notification.cancel_all_local()


## The `local_push` row of `local_push_id`, or `null` after an error log.
static func _local_push_row(operation: String, local_push_id: int) -> GameData.LocalPushRow:
	if not GameData.LocalPushTable.has_row(local_push_id):
		LogCore.log_error(_TAG, "%s: %d is not a local_push ID value" % [operation, local_push_id])
		return null
	return GameData.LocalPushTable.get_row(local_push_id)


## Schedules a row that passed the checks. Without the `GRANTED` permission cache nothing goes to the OS, with no log.
static func _schedule(row: GameData.LocalPushRow, delay_ms: int) -> bool:
	if _permission != PermissionStatus.GRANTED or _active_notification == null:
		return false
	var title: String = LocalizationCore.get_text(row.title)
	var body: String = LocalizationCore.get_text(row.body)
	if not _active_notification.schedule_local(row.id, title, body, delay_ms):
		LogCore.log_error(_TAG, "notification adapter could not schedule local_push %d" % row.id)
		return false
	return true


## `AuthCore.SessionEndedEvent`: a session that ended for another account clears the local push schedules.
static func _on_session_ended(reason: AuthCore.SessionEndReason) -> void:
	if (
		reason == AuthCore.SessionEndReason.LOGOUT
		or reason == AuthCore.SessionEndReason.SWITCH
		or reason == AuthCore.SessionEndReason.WITHDRAW
		or reason == AuthCore.SessionEndReason.AGE_BLOCKED
	):
		cancel_all_local()


# --- remote push ---


static func take_launch_push() -> int:
	if not _check("take_launch_push"):
		return 0
	if _push == null:
		return 0
	var message_id: int = _push.take_launch_push()
	if message_id < 0:
		LogCore.log_error(_TAG, "push adapter take_launch_push returned %d" % message_id)
		return 0
	return message_id


## Push adapter notification: a remote push came while the app runs.
static func _on_push_received(message_id: int) -> void:
	if _is_initialized:
		_publish_push(message_id, false)


## Push adapter notification: the user pressed a notification and came to the running app.
static func _on_push_opened(message_id: int) -> void:
	if _is_initialized:
		_publish_push(message_id, true)


static func _publish_push(message_id: int, opened: bool) -> void:
	if opened:
		var opened_event: PushOpenedEvent = EventCore.acquire(PushOpenedEvent) as PushOpenedEvent
		opened_event.message_id = message_id
		EventCore.publish(opened_event)
	else:
		var received_event: PushReceivedEvent = EventCore.acquire(PushReceivedEvent) as PushReceivedEvent
		received_event.message_id = message_id
		EventCore.publish(received_event)


# --- device token registration ---


## `AuthCore.LoginCompletedEvent`: asks the push adapter for the device token and registers it.
static func _register_token() -> void:
	var adapter: PushAdapter = _push
	if not _is_initialized or adapter == null:
		return
	var life: RefCounted = _life
	var wait: _TOKEN_WAIT = _TOKEN_WAIT.new()
	wait.deadline = TimeCore.get_real_time() + _token_timeout_ms
	_token_waits.append(wait)
	_ask_token(adapter, wait)
	if not wait.finished:
		await wait.done
	_token_waits.erase(wait)
	if life != _life:
		return
	_send_token(wait.token)


static func _ask_token(adapter: PushAdapter, wait: _TOKEN_WAIT) -> void:
	var token: String = await adapter.get_device_token()
	wait.finish(token)


## Push adapter notification: a new device token. It is registered while there is a session.
static func _on_token_changed(token: String) -> void:
	if not _is_initialized:
		return
	if AuthCore.is_initialized() and AuthCore.is_logged_in():
		_send_token(token)


## Sends `RegisterPushToken`. An empty token is not registered.
static func _send_token(token: String) -> void:
	if token.is_empty():
		return
	var request: CoreContract.RegisterPushTokenRequest = CoreContract.RegisterPushTokenRequest.new()
	request.device_token = token
	request.language = LocalizationCore.get_language_code()
	request.timezone_offset_ms = _timezone_offset_ms()
	NetworkCore.send(request, Callable(), _register_failed_call)


## Failure callback of `RegisterPushToken`: the next login or token change registers again.
static func _on_register_failed(_failure: RequestFailure) -> bool:
	return true


## UTC offset of the device time zone now, ms. Ahead of UTC is positive.
# ogw:input_boundary
static func _timezone_offset_ms() -> int:
	var zone: Dictionary = Time.get_time_zone_from_system()
	var bias: Variant = zone.get("bias", 0)
	if not bias is int:
		return 0
	var minutes: int = bias
	return minutes * _MS_PER_MINUTE


# --- frame ---


## Ends the device token waits past the time limit with no token, and lets the push adapter tell its notifications.
static func _on_frame() -> void:
	if not _is_initialized:
		return
	var now: int = TimeCore.get_real_time()
	var i: int = _token_waits.size() - 1
	while i >= 0:
		if i < _token_waits.size():
			var wait: _TOKEN_WAIT = _token_waits[i]
			if not wait.finished and now >= wait.deadline:
				wait.finish("")
		i -= 1
	if _push != null:
		_push.poll()


# --- ad push consent ---


static func get_push_consent() -> PushConsentInfo:
	var info: PushConsentInfo = PushConsentInfo.new()
	if not _check("get_push_consent"):
		return info
	var consent: ConsentInfo = AuthCore.get_consent()
	info.push_ad = consent.push_ad
	info.push_night = consent.push_night
	return info


static func set_push_consent(push_ad: CoreContract.ConsentChoice, push_night: CoreContract.ConsentChoice) -> bool:
	if not _check("set_push_consent"):
		return false
	var life: RefCounted = _life
	var ok: bool = await AuthCore.update_push_consent(push_ad, push_night)
	if life != _life:
		return false
	return ok
