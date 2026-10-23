extends Object
## `ogw-notification` plugin singleton of the PushCore core tests whose permission operations never end: a test
## registers it under the singleton name of `NativeNotificationAdapter`. The test frees it after unregistering it.

## Operation IDs of the started permission reads and requests, in order.
var started: PackedInt64Array = PackedInt64Array()
## Operation IDs of the started permission requests, in order.
var requests: PackedInt64Array = PackedInt64Array()
## `permission_state` calls.
var polls: int = 0
## Operation IDs `cancel_permission` got, in order.
var cancelled: PackedInt64Array = PackedInt64Array()


func start_read_permission() -> int:
	started.append(started.size() + 1)
	return started.size()


func start_request_permission() -> int:
	started.append(started.size() + 1)
	requests.append(started.size())
	return started.size()


func permission_state(_id: int) -> int:
	polls += 1
	return -1


func cancel_permission(id: int) -> void:
	cancelled.append(id)


func schedule_local(_id: int, _title: String, _body: String, _delay_ms: int) -> bool:
	return false


func cancel_local(_id: int) -> void:
	pass


func cancel_all_local() -> void:
	pass
