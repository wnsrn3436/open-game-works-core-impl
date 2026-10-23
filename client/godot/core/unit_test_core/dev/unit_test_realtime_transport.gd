class_name UnitTestRealtimeTransport
extends RealtimeDevTransport
## Fake realtime transport of `UnitTestCore`. `poll` adds the transport notifications that
## `UnitTestCore.add_realtime_notice` put in, in the order they were put in. It records every transport operation
## call but `poll` and `lockstep_time` in call order. `send_packet` returns the result
## `UnitTestCore.set_realtime_send_result` set for the participant, `true` when none was set. The transport DEV
## operations `force_close_peer` and `force_close_matchmaker` are recorded and give a peer lost and a matchmaker lost
## with error code 0 at the next `poll`. `lockstep_time` is always none.

## Notifications not added yet; `_next` is the first one `poll` has not added.
var _queued: Array[RealtimeNotice] = []
var _next: int = 0
var _send_results: Dictionary[int, bool] = {}
var _calls: Array[UnitTestRealtimeCall] = []
## Number of `poll` calls.
var _poll_count: int = 0


func start_matching(mode_id: int, access_token: String, lockstep: bool) -> void:
	_record("start_matching", PackedStringArray([str(mode_id), access_token, str(lockstep)]))


func cancel_matching() -> void:
	_record("cancel_matching", PackedStringArray())


func rejoin(match_id: String, access_token: String) -> void:
	_record("rejoin", PackedStringArray([match_id, access_token]))


func connect_peer(index: int) -> void:
	_record("connect_peer", PackedStringArray([str(index)]))


func send_packet(index: int, channel: RealtimeCore.RealtimeChannel, packet: PackedByteArray) -> bool:
	_record("send_packet", PackedStringArray([str(index), str(channel), packet.hex_encode()]))
	if _send_results.has(index):
		return _send_results[index]
	return true


func close_peer(index: int) -> void:
	_record("close_peer", PackedStringArray([str(index)]))


func close() -> void:
	_record("close", PackedStringArray())


func disconnect_all() -> void:
	_record("disconnect", PackedStringArray())


func poll() -> void:
	_poll_count += 1
	while _next < _queued.size():
		var queued: RealtimeNotice = _queued[_next]
		_next += 1
		add_notice(queued.kind).copy_from(queued)


func open_room(mode_id: int, room_code: String, access_token: String, lockstep: bool) -> void:
	_record("open_room", PackedStringArray([str(mode_id), room_code, access_token, str(lockstep)]))


func leave_room() -> void:
	_record("leave_room", PackedStringArray())


func kick_room_member(user_id: int) -> void:
	_record("kick_room_member", PackedStringArray([str(user_id)]))


func start_room() -> void:
	_record("start_room", PackedStringArray())


func force_close_peer(index: int) -> void:
	_record("force_close_peer", PackedStringArray([str(index)]))
	var notice: RealtimeNotice = RealtimeNotice.new()
	notice.reset(RealtimeNotice.Kind.PEER_LOST)
	notice.participant = index
	queue_notice(notice)


func force_close_matchmaker() -> void:
	_record("force_close_matchmaker", PackedStringArray())
	var notice: RealtimeNotice = RealtimeNotice.new()
	notice.reset(RealtimeNotice.Kind.MATCHMAKER_LOST)
	notice.error_code = 0
	queue_notice(notice)


## Puts a copy of `notice` in for the next `poll`.
func queue_notice(notice: RealtimeNotice) -> void:
	if _next == _queued.size():
		_queued.clear()
		_next = 0
	var copy: RealtimeNotice = RealtimeNotice.new()
	copy.copy_from(notice)
	_queued.append(copy)


func set_send_result(index: int, ok: bool) -> void:
	_send_results[index] = ok


func calls() -> Array[UnitTestRealtimeCall]:
	return _calls.duplicate()


func _record(operation: String, inputs: PackedStringArray) -> void:
	var entry: UnitTestRealtimeCall = UnitTestRealtimeCall.new()
	entry.name = operation
	entry.inputs = inputs
	_calls.append(entry)
