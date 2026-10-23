class_name PushCoreDev
extends RefCounted
## DEV operations of PushCore: the fake permission and schedule result, the schedule list of the fake notification
## adapter, simulated remote pushes and the fake launch push.

const _TAG: String = "PushCore"
## The fake adapters, read through these constants and not the global class names (Godot 4.7.2 keeps the generated
## contract and data scripts alive at exit when a file that names a base adapter type reads a derived adapter class's
## members through its global name).
const _FAKE_PUSH := preload("res://core/push_core/dev/adapters/fake_push_adapter.gd")
const _FAKE_NOTIFICATION := preload("res://core/push_core/dev/adapters/fake_notification_adapter.gd")


## Sets the permission the fake notification adapter PushCore holds returns from now on. The cache follows at the
## next read. Nothing changes when PushCore holds another notification adapter.
static func set_fake_permission(status: PushCore.PermissionStatus) -> void:
	if not PushCore._check("set_fake_permission"):
		return
	if status < PushCore.PermissionStatus.UNDETERMINED or status > PushCore.PermissionStatus.UNSUPPORTED:
		LogCore.log_error(_TAG, "set_fake_permission: %d is not a PermissionStatus" % status)
		return
	var adapter: _FAKE_NOTIFICATION = PushCore._notification as _FAKE_NOTIFICATION
	if adapter != null:
		adapter.permission = status


## Sets what `schedule_local` of the fake notification adapter PushCore holds returns. Nothing changes when PushCore
## holds another notification adapter.
static func set_fake_schedule_result(ok: bool) -> void:
	if not PushCore._check("set_fake_schedule_result"):
		return
	var adapter: _FAKE_NOTIFICATION = PushCore._notification as _FAKE_NOTIFICATION
	if adapter != null:
		adapter.schedule_result = ok


## Fills `buffer` from index 0 with the local pushes the fake notification adapter has scheduled, oldest schedule
## first. Returns the count filled.
static func list_scheduled_local(buffer: Array[ScheduledLocalPush]) -> int:
	if not PushCore._check("list_scheduled_local"):
		return 0
	var scheduled: Array[_FAKE_NOTIFICATION.Entry] = _FAKE_NOTIFICATION._scheduled
	if scheduled.size() > buffer.size():
		LogCore.log_error(_TAG, "list_scheduled_local: buffer of %d holds %d of %d schedules" % [buffer.size(), buffer.size(), scheduled.size()])
	var count: int = mini(scheduled.size(), buffer.size())
	var now: int = TimeCore.get_device_time()
	for i: int in count:
		var out: ScheduledLocalPush = buffer[i]
		if out == null:
			out = ScheduledLocalPush.new()
			buffer[i] = out
		out.id = scheduled[i].id
		out.remaining_ms = maxi(0, scheduled[i].fire_at - now)
	return count


## Publishes the event of a remote push the fake push adapter got: `PushOpenedEvent` when `opened`, else
## `PushReceivedEvent`.
static func simulate_push(message_id: int, opened: bool) -> void:
	if not PushCore._check("simulate_push"):
		return
	PushCore._publish_push(message_id, opened)


## Sets the launch push the fake push adapter gives next.
static func set_fake_launch_push(message_id: int) -> void:
	if not PushCore._check("set_fake_launch_push"):
		return
	if message_id < 0:
		LogCore.log_error(_TAG, "set_fake_launch_push: message ID value %d is negative" % message_id)
		return
	_FAKE_PUSH._launch_push = message_id
