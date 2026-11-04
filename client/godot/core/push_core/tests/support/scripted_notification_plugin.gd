extends Object
## Scripted `ogw-notification` plugin singleton of the PushCore core tests: a test registers it under the singleton
## name of `NativeNotificationAdapter`, so the real adapter reads the permission and schedules local pushes through it
## as through the plugin. By default its permission operations never end. The test frees it after unregistering it.


## One `schedule_local` call.
class Scheduled extends RefCounted:
	var id: int = 0
	var title: String = ""
	var body: String = ""
	var delay_ms: int = 0


## `permission_state` of a running permission read: -1 while it runs, then 0 undetermined, 1 granted, 2 denied.
var read_state: int = -1
## `permission_state` of a running permission request: -1 until the user picks, then 0, 1, 2.
var request_state: int = -1
## `start_*` returns 0, the operation ID of an operation that cannot start.
var cannot_start: bool = false
var schedule_result: bool = true
## Operation IDs of the started permission reads and requests, in order.
var started: PackedInt64Array = PackedInt64Array()
## Operation IDs of the started permission requests, in order.
var requests: PackedInt64Array = PackedInt64Array()
## `permission_state` calls.
var polls: int = 0
## Operation IDs `cancel_permission` got, in order.
var cancelled: PackedInt64Array = PackedInt64Array()
var scheduled: Array[Scheduled] = []
var cancelled_local: PackedInt64Array = PackedInt64Array()
var cancel_all_calls: int = 0


func start_read_permission() -> int:
	if cannot_start:
		return 0
	started.append(started.size() + 1)
	return started.size()


func start_request_permission() -> int:
	if cannot_start:
		return 0
	started.append(started.size() + 1)
	requests.append(started.size())
	return started.size()


func permission_state(id: int) -> int:
	polls += 1
	if id <= 0:
		return -1
	return request_state if requests.has(id) else read_state


func cancel_permission(id: int) -> void:
	cancelled.append(id)


func schedule_local(id: int, title: String, body: String, delay_ms: int) -> bool:
	var call: Scheduled = Scheduled.new()
	call.id = id
	call.title = title
	call.body = body
	call.delay_ms = delay_ms
	scheduled.append(call)
	return schedule_result


func cancel_local(id: int) -> void:
	cancelled_local.append(id)


func cancel_all_local() -> void:
	cancel_all_calls += 1
