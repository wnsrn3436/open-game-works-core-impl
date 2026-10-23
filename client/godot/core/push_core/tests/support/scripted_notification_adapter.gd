extends NotificationAdapter
## Scripted notification adapter of the PushCore core tests: the OS permission, the result of the permission request
## screen, and the calls PushCore made.


## One `schedule_local` call.
class Scheduled extends RefCounted:
	var id: int = 0
	var title: String = ""
	var body: String = ""
	var delay_ms: int = 0


## Permission the OS has. `read_permission` returns it at once.
var permission: PushCore.PermissionStatus = PushCore.PermissionStatus.GRANTED
## What the user picks on the permission request screen.
var request_result: PushCore.PermissionStatus = PushCore.PermissionStatus.GRANTED
var schedule_result: bool = true
var read_calls: int = 0
## Permission request screens shown.
var request_calls: int = 0
var cancel_all_calls: int = 0
var cancelled: PackedInt64Array = PackedInt64Array()
var scheduled: Array[Scheduled] = []


func read_permission() -> PushCore.PermissionStatus:
	read_calls += 1
	return permission


func request_permission() -> PushCore.PermissionStatus:
	request_calls += 1
	permission = request_result
	return request_result


func schedule_local(id: int, title: String, body: String, delay_ms: int) -> bool:
	var call: Scheduled = Scheduled.new()
	call.id = id
	call.title = title
	call.body = body
	call.delay_ms = delay_ms
	scheduled.append(call)
	return schedule_result


func cancel_local(id: int) -> void:
	cancelled.append(id)


func cancel_all_local() -> void:
	cancel_all_calls += 1
