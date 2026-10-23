class_name RealtimeRecordingTransport
extends RealtimeDevTransport
## Test transport that passes every transport operation to the wrapped `UnitTestCore` fake realtime transport and
## keeps a text line of each call, and passes up the notifications of the fake.

var inner: RealtimeTransport = null
## One line per call, in call order: `<operation>(<inputs>)`.
var calls: PackedStringArray = PackedStringArray()
## Packet of each `send_packet` call, in call order.
var packets: Array[PackedByteArray] = []
## Participant index of each `send_packet` call, in call order.
var packet_targets: PackedInt32Array = PackedInt32Array()
var lockstep_value: int = RealtimeTransport.NO_TIME


func _init(wrapped: RealtimeTransport) -> void:
	super()
	inner = wrapped


func start_matching(mode_id: int, access_token: String, lockstep: bool) -> void:
	calls.append("start_matching(%d, %s, %s)" % [mode_id, access_token, lockstep])
	inner.start_matching(mode_id, access_token, lockstep)


func cancel_matching() -> void:
	calls.append("cancel_matching()")
	inner.cancel_matching()


func rejoin(match_id: String, access_token: String) -> void:
	calls.append("rejoin(%s, %s)" % [match_id, access_token])
	inner.rejoin(match_id, access_token)


func connect_peer(index: int) -> void:
	calls.append("connect_peer(%d)" % index)
	inner.connect_peer(index)


func send_packet(index: int, channel: RealtimeCore.RealtimeChannel, packet: PackedByteArray) -> bool:
	calls.append("send_packet(%d, %d)" % [index, channel])
	packets.append(packet.duplicate())
	packet_targets.append(index)
	return inner.send_packet(index, channel, packet)


func close_peer(index: int) -> void:
	calls.append("close_peer(%d)" % index)
	inner.close_peer(index)


func close() -> void:
	calls.append("close()")
	inner.close()


func disconnect_all() -> void:
	calls.append("disconnect()")
	inner.disconnect_all()


func poll() -> void:
	inner.poll()
	var notice: RealtimeNotice = inner.take_notice()
	while notice != null:
		add_notice(notice.kind).copy_from(notice)
		notice = inner.take_notice()


func open_room(mode_id: int, room_code: String, access_token: String, lockstep: bool) -> void:
	calls.append("open_room(%d, %s, %s, %s)" % [mode_id, room_code, access_token, lockstep])
	inner.open_room(mode_id, room_code, access_token, lockstep)


func leave_room() -> void:
	calls.append("leave_room()")
	inner.leave_room()


func kick_room_member(user_id: int) -> void:
	calls.append("kick_room_member(%d)" % user_id)
	inner.kick_room_member(user_id)


func start_room() -> void:
	calls.append("start_room()")
	inner.start_room()


func lockstep_time() -> int:
	return lockstep_value if lockstep_value != RealtimeTransport.NO_TIME else inner.lockstep_time()


func force_close_peer(index: int) -> void:
	calls.append("force_close_peer(%d)" % index)
	RealtimeCoreDev._force_close_peer(inner, index)


func force_close_matchmaker() -> void:
	calls.append("force_close_matchmaker()")
	RealtimeCoreDev._force_close_matchmaker(inner)


## Number of calls of `operation`.
func count(operation: String) -> int:
	var found: int = 0
	var prefix: String = operation + "("
	for line: String in calls:
		if line.begins_with(prefix):
			found += 1
	return found


## Forgets the calls and packets so far.
func clear_calls() -> void:
	calls.clear()
	packets.clear()
	packet_targets.clear()
