class_name FakeNotificationAdapter
extends NotificationAdapter
## Fake notification adapter. The permission read and request show no screen and return the `PushCoreDev`
## `set_fake_permission` value, `GRANTED` by default, one frame later as an OS read would. Schedules go to a list,
## not to the OS. `schedule_local` returns the `set_fake_schedule_result` value and leaves the list alone on `false`.


## One scheduled local push of the list.
class Entry extends RefCounted:
	var id: int = 0
	var title: String = ""
	var body: String = ""
	## `TimeCore` device time at which the notification shows.
	var fire_at: int = 0


## Scheduled local pushes, oldest schedule first. Process state: like the OS schedules it stands for, it outlives
## `PushCore.release` and the adapter object.
static var _scheduled: Array[Entry] = []

## Permission the read and the request return. `PushCoreDev.set_fake_permission` sets it on the adapter PushCore
## holds; a new adapter, as after `PushCore.release`, starts at `GRANTED`.
var permission: PushCore.PermissionStatus = PushCore.PermissionStatus.GRANTED
## What `schedule_local` returns. `PushCoreDev.set_fake_schedule_result` sets it on the adapter PushCore holds.
var schedule_result: bool = true


func read_permission() -> PushCore.PermissionStatus:
	await (Engine.get_main_loop() as SceneTree).process_frame
	return permission


func request_permission() -> PushCore.PermissionStatus:
	await (Engine.get_main_loop() as SceneTree).process_frame
	return permission


func schedule_local(id: int, title: String, body: String, delay_ms: int) -> bool:
	if not schedule_result:
		return false
	_remove(id)
	var entry: Entry = Entry.new()
	entry.id = id
	entry.title = title
	entry.body = body
	entry.fire_at = TimeCore.get_device_time() + delay_ms
	_scheduled.append(entry)
	return true


func cancel_local(id: int) -> void:
	_remove(id)


func cancel_all_local() -> void:
	_scheduled.clear()


static func _remove(id: int) -> void:
	for i: int in range(_scheduled.size() - 1, -1, -1):
		if _scheduled[i].id == id:
			_scheduled.remove_at(i)
