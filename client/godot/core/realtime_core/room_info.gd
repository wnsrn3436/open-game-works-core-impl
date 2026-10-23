class_name RoomInfo
extends RefCounted
## One room: the values of the server `ROOM_STATE`. The empty `RoomInfo` has an empty room code and no members.
## A caller does not change a `RoomInfo` it got from `RealtimeCore`.

## Room code.
var room_code: String = ""
## Match mode ID value.
var mode_id: int = 0
## Member user IDs in join order. The first member is the host.
var members: PackedInt64Array = PackedInt64Array()
## Queue state of the room.
var status: CoreContract.RoomStatus = CoreContract.RoomStatus.ROOM_STATUS_UNSPECIFIED


## Whether this is the empty `RoomInfo`.
func _is_empty() -> bool:
	return room_code.is_empty() and members.is_empty()


## A new `RoomInfo` with the same values.
func _copy() -> RoomInfo:
	var info: RoomInfo = RoomInfo.new()
	info.room_code = room_code
	info.mode_id = mode_id
	info.members = members.duplicate()
	info.status = status
	return info
