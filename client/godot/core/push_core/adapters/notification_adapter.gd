class_name NotificationAdapter
extends RefCounted
## Base of the notification adapters. A notification adapter wraps the platform's OS notification API: the
## notification permission and the local pushes. It does not use the OS push service. `BootstrapCore` passes one
## with `PushCore.set_notification_adapter`. Only PushCore calls it.


## Time limit of `read_permission`, ms: `PushCore.permissionReadTimeoutMs`. Set by `PushCore.init`. A read past it
## ends with `UNDETERMINED`. `request_permission` waits for the user and has no time limit.
var permission_read_timeout_ms: int = 0


## PushCore `init` took this adapter.
func start() -> void:
	pass


## PushCore `release` dropped this adapter. A running read or request ends with `UNDETERMINED`.
func stop() -> void:
	pass


## Async. The notification permission state the OS has now.
func read_permission() -> PushCore.PermissionStatus:
	return PushCore.PermissionStatus.UNDETERMINED


## Async. Shows the OS permission request screen and returns its result.
func request_permission() -> PushCore.PermissionStatus:
	return PushCore.PermissionStatus.UNDETERMINED


## Schedules local push `id` with `title` and `body` `delay_ms` from now, in place of an earlier schedule of `id`.
func schedule_local(_id: int, _title: String, _body: String, _delay_ms: int) -> bool:
	return false


func cancel_local(_id: int) -> void:
	pass


func cancel_all_local() -> void:
	pass
