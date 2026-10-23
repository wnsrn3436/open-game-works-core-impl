class_name SimRealtimeTransport
extends RealtimeDevTransport
## The DEV network simulation transport: delays every packet it sends through the wrapped transport by
## `RealtimeCore.simLatencyMs` plus 0 to `RealtimeCore.simJitterMs`, keeps `Reliable` in send order without loss, and
## drops `Unreliable` packets at `RealtimeCore.simLossPermille`. With all three 0 it adds no delay and no loss.

const _SIM_PACKET := preload("res://core/realtime_core/dev/sim_packet.gd")
const _PURPOSE: String = "realtime_sim"

var _inner: RealtimeTransport = null
var _latency_ms: int = 0
var _jitter_ms: int = 0
var _loss_permille: int = 0
var _random := UtilCore.create_random(UtilCore.make_purpose_seed(_PURPOSE, 0))
## Packets waiting for their arrival time, in send order.
var _waiting: Array[_SIM_PACKET] = []
## Arrival time of the last `Reliable` packet of each participant index.
var _last_reliable_at: Dictionary[int, int] = {}


func _init(inner: RealtimeTransport) -> void:
	super()
	_inner = inner
	_latency_ms = _setting("RealtimeCore.simLatencyMs")
	_jitter_ms = _setting("RealtimeCore.simJitterMs")
	_loss_permille = _setting("RealtimeCore.simLossPermille")


func start_matching(mode_id: int, access_token: String, lockstep: bool) -> void:
	_inner.start_matching(mode_id, access_token, lockstep)


func cancel_matching() -> void:
	_inner.cancel_matching()


func rejoin(match_id: String, access_token: String) -> void:
	_inner.rejoin(match_id, access_token)


func connect_peer(index: int) -> void:
	_inner.connect_peer(index)


func send_packet(index: int, channel: RealtimeCore.RealtimeChannel, packet: PackedByteArray) -> bool:
	if _latency_ms == 0 and _jitter_ms == 0 and _loss_permille == 0:
		return _inner.send_packet(index, channel, packet)
	if channel == RealtimeCore.RealtimeChannel.UNRELIABLE and _loss_permille > 0:
		if UtilCore.range_int(_random, 0, 999) < _loss_permille:
			return true
	var delay: int = _latency_ms
	if _jitter_ms > 0:
		delay += UtilCore.range_int(_random, 0, _jitter_ms)
	var deliver_at: int = TimeCore.get_monotonic_time() + delay
	if channel == RealtimeCore.RealtimeChannel.RELIABLE:
		if _last_reliable_at.has(index):
			deliver_at = maxi(deliver_at, _last_reliable_at[index])
		_last_reliable_at[index] = deliver_at
	var held: _SIM_PACKET = _SIM_PACKET.new()
	held.deliver_at = deliver_at
	held.participant = index
	held.channel = channel
	held.packet = packet.duplicate()
	_waiting.append(held)
	return true


func close_peer(index: int) -> void:
	_drop_waiting(index)
	_inner.close_peer(index)


func close() -> void:
	_deliver_all()
	_inner.close()


func disconnect_all() -> void:
	_deliver_all()
	_inner.disconnect_all()


func poll() -> void:
	_deliver_due()
	_inner.poll()
	var notice: RealtimeNotice = _inner.take_notice()
	while notice != null:
		if notice.kind == RealtimeNotice.Kind.MATCH_FOUND and notice.match_info != null:
			_random = UtilCore.create_random(UtilCore.make_purpose_seed(_PURPOSE, notice.match_info.match_seed))
			_waiting.clear()
			_last_reliable_at.clear()
		add_notice(notice.kind).copy_from(notice)
		notice = _inner.take_notice()


func open_room(mode_id: int, room_code: String, access_token: String, lockstep: bool) -> void:
	_inner.open_room(mode_id, room_code, access_token, lockstep)


func leave_room() -> void:
	_inner.leave_room()


func kick_room_member(user_id: int) -> void:
	_inner.kick_room_member(user_id)


func start_room() -> void:
	_inner.start_room()


func lockstep_time() -> int:
	return _inner.lockstep_time()


func force_close_peer(index: int) -> void:
	RealtimeCoreDev._force_close_peer(_inner, index)


func force_close_matchmaker() -> void:
	RealtimeCoreDev._force_close_matchmaker(_inner)


## Sends the held packets whose arrival time came, in send order.
func _deliver_due() -> void:
	if _waiting.is_empty():
		return
	var now: int = TimeCore.get_monotonic_time()
	var i: int = 0
	while i < _waiting.size():
		var held: _SIM_PACKET = _waiting[i]
		if held.deliver_at > now:
			i += 1
			continue
		_waiting.remove_at(i)
		_inner.send_packet(held.participant, held.channel, held.packet)


## Sends every held packet now, in send order, so a packet sent before `close` or `disconnect`, the leave notice among
## them, is not lost.
func _deliver_all() -> void:
	var held_packets: Array[_SIM_PACKET] = _waiting
	_waiting = []
	_last_reliable_at.clear()
	for held: _SIM_PACKET in held_packets:
		_inner.send_packet(held.participant, held.channel, held.packet)


func _drop_waiting(index: int) -> void:
	var i: int = 0
	while i < _waiting.size():
		if _waiting[i].participant == index:
			_waiting.remove_at(i)
		else:
			i += 1


func _setting(key: String) -> int:
	if not CoreSettings.has_int(key):
		return 0
	return CoreSettings.get_int(key)
