class_name LockstepRealtimeTransport
extends RealtimeDevTransport
## The DEV lockstep transport. It wraps another transport. In a lockstep match the participants in `TimeCore` step
## mode stop the match time together and advance it together by the same steps. The lockstep notices are `Reliable`
## control messages: step `[1, 2, k, ms]`, step end `[1, 3, k]`, step request `[1, 4, ms]`, with k and ms 4-byte
## big-endian unsigned integers. They do not go up as packet received.

const _STEP_WAITER := preload("res://core/realtime_core/dev/step_waiter.gd")
const _TAG: String = "RealtimeCore"
const _CONTROL: int = 1
const _STEP: int = 2
const _STEP_END: int = 3
const _STEP_REQUEST: int = 4
const _UINT32_MAX: int = 4294967295

var _inner: RealtimeTransport = null
var _is_lockstep: bool = false
var _my_index: int = -1
## 1 for a participant index the wrapped transport reports connected.
var _connected: PackedByteArray = PackedByteArray()
## 1 for a participant index that was connected once.
var _ever_connected: PackedByteArray = PackedByteArray()
## 1 for a participant index `close_peer` closed.
var _closed: PackedByteArray = PackedByteArray()
## Largest step number whose end came from each participant index.
var _ends: PackedInt64Array = PackedInt64Array()
## Game time when every other participant was first connected; -1 before.
var _connected_game_time: int = -1
## ms of each received step number.
var _steps: Dictionary[int, int] = {}
var _max_step: int = 0
var _running_step: int = 0
var _finished_step: int = 0
## The waiting `request_step`; `null` when none waits.
var _request: _STEP_WAITER = null
## ms of the waiting request whose step notice did not come yet; -1 when none.
var _request_ms: int = -1
## Step number of the waiting request; 0 until it is known.
var _request_step: int = 0
var _buffer: PackedByteArray = PackedByteArray()


func _init(inner: RealtimeTransport) -> void:
	super()
	_inner = inner


func start_matching(mode_id: int, access_token: String, _lockstep: bool) -> void:
	_inner.start_matching(mode_id, access_token, TimeCoreDev.is_step_mode())


func cancel_matching() -> void:
	_inner.cancel_matching()


func rejoin(match_id: String, access_token: String) -> void:
	_inner.rejoin(match_id, access_token)


func connect_peer(index: int) -> void:
	_inner.connect_peer(index)


func send_packet(index: int, channel: RealtimeCore.RealtimeChannel, packet: PackedByteArray) -> bool:
	return _inner.send_packet(index, channel, packet)


func close_peer(index: int) -> void:
	_inner.close_peer(index)
	if not _is_lockstep or index < 0 or index >= _closed.size() or _closed[index] == 1:
		return
	var before: int = _sequencer()
	_closed[index] = 1
	_connected[index] = 0
	var after: int = _sequencer()
	if after == before or _request == null or _request_step != 0:
		return
	if after == _my_index:
		_request_step = _make_step(_request_ms)
		_request_ms = -1
	else:
		_send_request(after, _request_ms)


func close() -> void:
	_end_lockstep()
	_inner.close()


func disconnect_all() -> void:
	_end_lockstep()
	_inner.disconnect_all()


func poll() -> void:
	_progress()
	_inner.poll()
	var notice: RealtimeNotice = _inner.take_notice()
	while notice != null:
		match notice.kind:
			RealtimeNotice.Kind.MATCH_FOUND:
				_begin_match(notice.match_info)
			RealtimeNotice.Kind.PEER_CONNECTED:
				_on_peer_connected(notice.participant)
			RealtimeNotice.Kind.PEER_LOST:
				if _is_participant(notice.participant):
					_connected[notice.participant] = 0
		if not (notice.kind == RealtimeNotice.Kind.PACKET_RECEIVED and _take_lockstep_notice(notice)):
			add_notice(notice.kind).copy_from(notice)
		notice = _inner.take_notice()


func open_room(mode_id: int, room_code: String, access_token: String, _lockstep: bool) -> void:
	_inner.open_room(mode_id, room_code, access_token, TimeCoreDev.is_step_mode())


func leave_room() -> void:
	_inner.leave_room()


func kick_room_member(user_id: int) -> void:
	_inner.kick_room_member(user_id)


func start_room() -> void:
	_inner.start_room()


func lockstep_time() -> int:
	if not _is_lockstep:
		return _inner.lockstep_time()
	if _connected_game_time < 0:
		return 0
	return TimeCore.get_game_time() - _connected_game_time


func force_close_peer(index: int) -> void:
	RealtimeCoreDev._force_close_peer(_inner, index)


func force_close_matchmaker() -> void:
	RealtimeCoreDev._force_close_matchmaker(_inner)


## The transport DEV operation `request_step`: waits until this participant finishes the step of the request.
func request_step(ms: int) -> bool:
	if not _is_lockstep or not TimeCoreDev.is_step_mode():
		LogCore.log_warn(_TAG, "request_step: not a lockstep match, or not in step mode")
		return false
	if ms < 1 or ms > _UINT32_MAX:
		LogCore.log_warn(_TAG, "request_step: ms is out of range")
		return false
	if _request != null:
		LogCore.log_warn(_TAG, "request_step: a request is waiting")
		return false
	var request: _STEP_WAITER = _STEP_WAITER.new()
	_request = request
	if _sequencer() == _my_index:
		_request_step = _make_step(ms)
		_request_ms = -1
	else:
		_request_step = 0
		_request_ms = ms
		_send_request(_sequencer(), ms)
	if not request.done:
		await request.finished
	return request.ok


func _begin_match(info: MatchInfo) -> void:
	_end_lockstep()
	if info == null or not info.lockstep:
		return
	var count: int = info.user_ids.size()
	_is_lockstep = true
	_my_index = info.my_index
	_connected.resize(count)
	_ever_connected.resize(count)
	_closed.resize(count)
	_ends.resize(count)
	for i: int in count:
		_connected[i] = 0
		_ever_connected[i] = 0
		_closed[i] = 0
		_ends[i] = 0


func _end_lockstep() -> void:
	var request: _STEP_WAITER = _request
	_is_lockstep = false
	_my_index = -1
	_connected.resize(0)
	_ever_connected.resize(0)
	_closed.resize(0)
	_ends.resize(0)
	_connected_game_time = -1
	_steps.clear()
	_max_step = 0
	_running_step = 0
	_finished_step = 0
	_request = null
	_request_ms = -1
	_request_step = 0
	if request != null:
		request.finish(false)


func _on_peer_connected(index: int) -> void:
	if not _is_lockstep or not _is_participant(index) or _closed[index] == 1:
		return
	var reconnected: bool = _ever_connected[index] == 1
	_connected[index] = 1
	_ever_connected[index] = 1
	if reconnected:
		if _sequencer() == _my_index:
			for k: int in range(_ends[index] + 1, _max_step + 1):
				if _steps.has(k):
					_send_step(index, k, _steps[k])
		else:
			if _finished_step > 0:
				_send_end(index, _finished_step)
			if index == _sequencer() and _request != null and _request_step == 0:
				_send_request(index, _request_ms)
	if _connected_game_time < 0 and _all_ever_connected():
		_connected_game_time = TimeCore.get_game_time()


## Takes a lockstep notice of a lockstep match. Returns `false` for a packet that is not one.
func _take_lockstep_notice(notice: RealtimeNotice) -> bool:
	var packet: PackedByteArray = notice.packet
	if not _is_lockstep or notice.channel != RealtimeCore.RealtimeChannel.RELIABLE:
		return false
	if packet.size() < 2 or packet[0] != _CONTROL:
		return false
	var sender: int = notice.participant
	if not _is_participant(sender):
		return false
	match packet[1]:
		_STEP:
			if packet.size() != 10:
				return false
			_on_step(_read_u32(packet, 2), _read_u32(packet, 6))
			return true
		_STEP_END:
			if packet.size() != 6:
				return false
			_ends[sender] = maxi(_ends[sender], _read_u32(packet, 2))
			return true
		_STEP_REQUEST:
			if packet.size() != 6:
				return false
			var ms: int = _read_u32(packet, 2)
			if _sequencer() == _my_index and ms >= 1:
				_make_step(ms)
			return true
	return false


func _on_step(k: int, ms: int) -> void:
	if k <= _max_step or _steps.has(k) or ms < 1:
		return
	_steps[k] = ms
	_max_step = k
	if _request != null and _request_step == 0:
		_request_step = k
		_request_ms = -1


## Makes the next step as the sequencer, sends it to the other connected participants and takes it. Returns its number.
func _make_step(ms: int) -> int:
	var k: int = _max_step + 1
	_steps[k] = ms
	_max_step = k
	for i: int in _connected.size():
		if i != _my_index and _connected[i] == 1 and _closed[i] == 0:
			_send_step(i, k, ms)
	return k


## Ends the running step when its budget is used up, then starts the next step when it can.
func _progress() -> void:
	if not _is_lockstep:
		return
	if _running_step != 0:
		if TimeCoreDev.get_step_budget() > 0:
			return
		var finished: int = _running_step
		_running_step = 0
		_finished_step = finished
		for i: int in _connected.size():
			if i != _my_index and _connected[i] == 1 and _closed[i] == 0:
				_send_end(i, finished)
		if _request != null and _request_step == finished:
			var request: _STEP_WAITER = _request
			_request = null
			_request_step = 0
			request.finish(true)
	var next: int = _finished_step + 1
	if not _steps.has(next) or not TimeCoreDev.is_step_mode():
		return
	if next > 1 and not _all_ended(next - 1):
		return
	_running_step = next
	TimeCoreDev.add_step_budget(_steps[next])


func _all_ended(k: int) -> bool:
	for i: int in _ends.size():
		if i != _my_index and _closed[i] == 0 and _ends[i] < k:
			return false
	return true


func _all_ever_connected() -> bool:
	for i: int in _ever_connected.size():
		if i != _my_index and _ever_connected[i] == 0:
			return false
	return true


## The participant with the smallest index among this participant and the ones `close_peer` did not close.
func _sequencer() -> int:
	for i: int in _closed.size():
		if i == _my_index or _closed[i] == 0:
			return i
	return _my_index


func _is_participant(index: int) -> bool:
	return index >= 0 and index < _connected.size() and index != _my_index


func _send_step(index: int, k: int, ms: int) -> void:
	_buffer.resize(10)
	_buffer[0] = _CONTROL
	_buffer[1] = _STEP
	_write_u32(_buffer, 2, k)
	_write_u32(_buffer, 6, ms)
	_inner.send_packet(index, RealtimeCore.RealtimeChannel.RELIABLE, _buffer)


func _send_end(index: int, k: int) -> void:
	_buffer.resize(6)
	_buffer[0] = _CONTROL
	_buffer[1] = _STEP_END
	_write_u32(_buffer, 2, k)
	_inner.send_packet(index, RealtimeCore.RealtimeChannel.RELIABLE, _buffer)


func _send_request(index: int, ms: int) -> void:
	if index < 0 or index == _my_index:
		return
	_buffer.resize(6)
	_buffer[0] = _CONTROL
	_buffer[1] = _STEP_REQUEST
	_write_u32(_buffer, 2, ms)
	_inner.send_packet(index, RealtimeCore.RealtimeChannel.RELIABLE, _buffer)


static func _read_u32(bytes: PackedByteArray, offset: int) -> int:
	return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]


static func _write_u32(bytes: PackedByteArray, offset: int, value: int) -> void:
	bytes[offset] = (value >> 24) & 0xff
	bytes[offset + 1] = (value >> 16) & 0xff
	bytes[offset + 2] = (value >> 8) & 0xff
	bytes[offset + 3] = value & 0xff
