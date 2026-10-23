class_name RealtimeEventRecorder
extends Node
## Test subscriber of the `RealtimeCore` events. Keeps one text line per event, in publish order.

var lines: PackedStringArray = PackedStringArray()
## `RealtimeCore.match_state` when each `MatchEndedEvent` came.
var state_at_end: PackedInt32Array = PackedInt32Array()
## Room code of the `RoomInfo` of each `RoomChangedEvent`.
var room_codes: PackedStringArray = PackedStringArray()


func subscribe_all() -> bool:
	return (
		EventCore.subscribe(PeerDisconnectedEvent, _on_disconnected)
		and EventCore.subscribe(PeerReconnectedEvent, _on_reconnected)
		and EventCore.subscribe(PeerLeftEvent, _on_left)
		and EventCore.subscribe(MatchEndedEvent, _on_ended)
		and EventCore.subscribe(RoomChangedEvent, _on_room_changed)
		and EventCore.subscribe(RoomMatchStartedEvent, _on_room_match_started)
	)


## Number of lines that start with `prefix`.
func count(prefix: String) -> int:
	var found: int = 0
	for line: String in lines:
		if line.begins_with(prefix):
			found += 1
	return found


func _on_disconnected(event: PeerDisconnectedEvent) -> void:
	lines.append("disconnected:%d" % event.participant)


func _on_reconnected(event: PeerReconnectedEvent) -> void:
	lines.append("reconnected:%d" % event.participant)


func _on_left(event: PeerLeftEvent) -> void:
	lines.append("left:%d:%s" % [event.participant, RealtimeCore.PeerLeaveReason.find_key(event.reason)])


func _on_ended(event: MatchEndedEvent) -> void:
	lines.append("ended:%s:%s" % [event.match_id, RealtimeCore.MatchEndReason.find_key(event.reason)])
	state_at_end.append(RealtimeCore.match_state())


func _on_room_changed(event: RoomChangedEvent) -> void:
	lines.append("room:%s" % RealtimeCore.RoomChangeReason.find_key(event.reason))
	room_codes.append(event.room.room_code)


func _on_room_match_started(_event: RoomMatchStartedEvent) -> void:
	lines.append("room_match_started")
