class_name NativeNotificationAdapter
extends NotificationAdapter
## Real notification adapter of `android` and `ios` through the `ogw-notification` plugin singleton: the
## notification permission and `WorkManager` delayed notifications on Android, `UNUserNotificationCenter` on iOS.
##
## Singleton methods:
## - `start_read_permission() -> int`, `start_request_permission() -> int`: start a permission read or the OS
##   permission request screen and return its operation ID
## - `permission_state(id: int) -> int`: -1 while the operation runs, then its result: 0 undetermined, 1 granted,
##   2 denied
## - `cancel_permission(id: int)`: the adapter stopped waiting for operation `id`; the plugin drops its result
## - `schedule_local(id: int, title: String, body: String, delay_ms: int) -> bool`
## - `cancel_local(id: int)`, `cancel_all_local()`
##
## A permission operation is read once a frame until it ends or `stop`. A read ends at `permission_read_timeout_ms`;
## the request waits for the user and has no time limit.

const _SINGLETON: String = "OgwNotification"
const _RUNNING: int = -1

var _plugin: Object = null
## New object every `stop`: a permission wait that finds another object ends.
var _life: RefCounted = RefCounted.new()


func stop() -> void:
	_life = RefCounted.new()


func read_permission() -> PushCore.PermissionStatus:
	var plugin: Object = _find_plugin()
	if plugin == null:
		return PushCore.PermissionStatus.UNDETERMINED
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_read_permission()
	return await _wait_permission(plugin, id, permission_read_timeout_ms)


func request_permission() -> PushCore.PermissionStatus:
	var plugin: Object = _find_plugin()
	if plugin == null:
		return PushCore.PermissionStatus.UNDETERMINED
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_request_permission()
	return await _wait_permission(plugin, id, -1)


func schedule_local(id: int, title: String, body: String, delay_ms: int) -> bool:
	var plugin: Object = _find_plugin()
	if plugin == null:
		return false
	@warning_ignore("unsafe_method_access")
	var ok: bool = plugin.schedule_local(id, title, body, delay_ms)
	return ok


func cancel_local(id: int) -> void:
	var plugin: Object = _find_plugin()
	if plugin == null:
		return
	@warning_ignore("unsafe_method_access")
	plugin.cancel_local(id)


func cancel_all_local() -> void:
	var plugin: Object = _find_plugin()
	if plugin == null:
		return
	@warning_ignore("unsafe_method_access")
	plugin.cancel_all_local()


## Waits for the end of permission operation `id`. `UNDETERMINED` when it ended with no status, did not end within
## `timeout_ms` (`TimeCore` real elapsed time; -1 for no limit), or `stop` came first; the last two tell the plugin
## with `cancel_permission`.
func _wait_permission(plugin: Object, id: int, timeout_ms: int) -> PushCore.PermissionStatus:
	var life: RefCounted = _life
	var deadline: int = TimeCore.get_real_time() + timeout_ms if timeout_ms >= 0 else -1
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null and life == _life and is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		var state: int = plugin.permission_state(id)
		if state == 1:
			return PushCore.PermissionStatus.GRANTED
		if state == 2:
			return PushCore.PermissionStatus.DENIED
		if state != _RUNNING:
			return PushCore.PermissionStatus.UNDETERMINED
		if deadline >= 0 and TimeCore.get_real_time() >= deadline:
			break
		await tree.process_frame
	if is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		plugin.cancel_permission(id)
	return PushCore.PermissionStatus.UNDETERMINED


func _find_plugin() -> Object:
	if not is_instance_valid(_plugin) and Engine.has_singleton(_SINGLETON):
		_plugin = Engine.get_singleton(_SINGLETON)
	return _plugin if is_instance_valid(_plugin) else null
