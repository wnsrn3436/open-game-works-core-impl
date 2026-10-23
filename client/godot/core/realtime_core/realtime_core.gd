class_name RealtimeCore
extends RefCounted
## Matching, rooms, the connections between the participants of a match, realtime message bytes, the match time,
## disconnects and leaves. A replaceable `RealtimeTransport` carries the connections; RealtimeCore and the realtime
## messages do not know the transport.

enum MatchState { NONE, MATCHING, CONNECTING, PLAYING }
enum PeerState { WAITING, CONNECTED, DISCONNECTED, LEFT }
enum RealtimeChannel { RELIABLE, UNRELIABLE }
enum MatchJoinStatus { SUCCESS, CANCELLED, FAILED }
enum RoomRequest { OPEN, KICK, START, MATCH }
enum RoomChangeReason { UPDATED, LEFT, KICKED, LOST }
enum MatchEndReason { ENDED, LEFT, BACKGROUND_TIMEOUT }
enum PeerLeaveReason { ENDED, LEFT, TIMEOUT }

## `send` target: every other `Connected` participant.
const ALL: int = -1

## How the current match started.
enum MatchOrigin { NONE, SOLO, ROOM_HOST, START_ROOM, ROOM_MEMBER, REJOIN }
## The transport operation that opened the matchmaker connection.
enum OpenOp { NONE, START_MATCHING, OPEN_ROOM, REJOIN }
## Step of the in-match rejoin.
enum RejoinPhase { IDLE, DELAY, TOKEN, RESULT }

const _TAG: String = "RealtimeCore"
const _NODE_SCRIPT := preload("res://core/realtime_core/realtime_core_node.gd")
const _MATCH_WAITER := preload("res://core/realtime_core/match_waiter.gd")
const _ROOM_WAITER := preload("res://core/realtime_core/room_waiter.gd")
const _PENDING_MESSAGE := preload("res://core/realtime_core/pending_message.gd")
const _INT64_MIN: int = -9223372036854775807 - 1

const _KIND_MESSAGE: int = 0
const _KIND_CONTROL: int = 1
const _CONTROL_LEAVE: int = 1
const _LEAVE_LEFT: int = 1
const _LEAVE_ENDED: int = 2

const _KEY_CONNECT_TIMEOUT: String = "RealtimeCore.connectTimeoutMs"
const _KEY_RECONNECT_TIMEOUT: String = "RealtimeCore.reconnectTimeoutMs"
const _KEY_BACKGROUND_TIMEOUT: String = "RealtimeCore.backgroundTimeoutMs"
const _KEY_MESSAGE_MAX: String = "RealtimeCore.messageMaxBytes"
const _KEY_PENDING_MAX: String = "RealtimeCore.pendingMessageMax"
const _KEY_RETRY_DELAY: String = "NetworkCore.retryDelayMs"
const _KEY_RETRY_FACTOR: String = "NetworkCore.retryDelayFactorPermille"
const _KEY_RETRY_DELAY_MAX: String = "NetworkCore.retryDelayMaxMs"
const _KEY_SIM_LATENCY: String = "RealtimeCore.simLatencyMs"
const _KEY_SIM_JITTER: String = "RealtimeCore.simJitterMs"
const _KEY_SIM_LOSS: String = "RealtimeCore.simLossPermille"

const _SAVE_MATCH_ID: String = "RealtimeCore.match_id"
const _SAVE_MODE_ID: String = "RealtimeCore.mode_id"
const _SAVE_MY_INDEX: String = "RealtimeCore.my_index"
const _SAVE_PLAYERS: String = "RealtimeCore.players"
const _SAVE_TEAMS: String = "RealtimeCore.teams"
const _SAVE_PARTIES: String = "RealtimeCore.parties"
const _SAVE_LOCKSTEP: String = "RealtimeCore.lockstep"
const _SAVE_SEED: String = "RealtimeCore.seed"
const _SAVE_START_AT: String = "RealtimeCore.start_at"
const _SAVE_KEYS: PackedStringArray = [
	_SAVE_MATCH_ID, _SAVE_MODE_ID, _SAVE_MY_INDEX, _SAVE_PLAYERS, _SAVE_TEAMS, _SAVE_PARTIES, _SAVE_LOCKSTEP, _SAVE_SEED,
	_SAVE_START_AT,
]
const _SETTING_KEYS: PackedStringArray = [
	_KEY_CONNECT_TIMEOUT, _KEY_RECONNECT_TIMEOUT, _KEY_BACKGROUND_TIMEOUT, _KEY_MESSAGE_MAX, _KEY_PENDING_MAX,
	_KEY_RETRY_DELAY, _KEY_RETRY_FACTOR, _KEY_RETRY_DELAY_MAX, _KEY_SIM_LATENCY, _KEY_SIM_JITTER, _KEY_SIM_LOSS,
]

static var _is_initialized: bool = false
## Session of the current `init`. An async operation stops when `release` replaces it.
static var _session: RefCounted = null
static var _node: Node = null
## Transport `set_transport` gave. `release` clears it.
static var _transport: RealtimeTransport = null

static var _connect_timeout_ms: int = 0
static var _reconnect_timeout_ms: int = 0
static var _background_timeout_ms: int = 0
static var _message_max_bytes: int = 0
static var _pending_max: int = 0
static var _retry_delay_ms: int = 0
static var _retry_factor_permille: int = 0
static var _retry_delay_max_ms: int = 0

static var _state: MatchState = MatchState.NONE
static var _origin: MatchOrigin = MatchOrigin.NONE
## `MatchInfo` of the match in `Connecting` and `Playing`; `null` otherwise.
static var _info: MatchInfo = null
## `PeerState` of each participant. The own index is unused.
static var _peer_states: PackedInt32Array = PackedInt32Array()
## Monotonic time each participant became `Disconnected`.
static var _lost_at: PackedInt64Array = PackedInt64Array()
## Monotonic time the match became `Connecting`.
static var _connecting_at: int = 0
## Result of the current match. `null` in `None`.
static var _waiter: _MATCH_WAITER = null
## Whether `RoomMatchStartedEvent` was published for the current match.
static var _room_started_published: bool = false
## Count of changes to `None`. A `poll` drops the rest of its notifications when it changes.
static var _none_count: int = 0
## Count of changes of the `MatchState` and the room.
static var _change_count: int = 0

## `RoomInfo` of the room; `null` out of a room.
static var _room: RoomInfo = null
## The waiting `create_room` or `join_room`; `null` when none waits.
static var _room_waiter: _ROOM_WAITER = null

## Registered `on_realtime_message` hook.
static var _hook: Callable = Callable()
static var _no_hook: Callable = Callable()
static var _pending: Array[_PENDING_MESSAGE] = []
## Whether the full pending queue logged its error in the current match.
static var _pending_full_logged: bool = false
## Whether a throw of the hook logged its error in the current match.
static var _hook_throw_logged: bool = false
static var _send_buffer: PackedByteArray = PackedByteArray()
static var _receive_buffer: PackedByteArray = PackedByteArray()

static var _open_op: OpenOp = OpenOp.NONE
static var _open_mode_id: int = 0
static var _open_room_code: String = ""
static var _open_match_id: String = ""
## Whether the open operation was called again for `TOKEN_EXPIRED`.
static var _open_retried: bool = false
static var _refresh_task: Callable = Callable()

static var _rejoin_phase: RejoinPhase = RejoinPhase.IDLE
static var _rejoin_first: bool = true
static var _rejoin_delay_ms: int = 0
static var _rejoin_at: int = 0
## Generation of the in-match rejoin token task. A task of an older generation does nothing.
static var _rejoin_generation: int = 0
static var _rejoin_task: Callable = Callable()


# --- lifecycle ---


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not _read_settings():
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init: the main loop is not a SceneTree")
		return false
	_session = RefCounted.new()
	_refresh_task = _run_token_refresh
	_rejoin_task = _run_rejoin_token
	_send_buffer.resize(_message_max_bytes + 1)
	_receive_buffer.resize(_message_max_bytes)
	var node: _NODE_SCRIPT = _NODE_SCRIPT.new()
	node.name = _TAG
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	_node = node
	tree.root.add_child(node)
	_is_initialized = true
	if not EventCore.subscribe(AppForegroundReturnedEvent, node._on_foreground_returned):
		LogCore.log_error(_TAG, "init: could not subscribe to AppForegroundReturnedEvent")
		release()
		return false
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: Node = _node
	if is_instance_valid(node) and EventCore.is_initialized():
		EventCore.unsubscribe_all(node)
	_teardown()
	if is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


# --- API ---


## Passes the transport. Called before `init`.
static func set_transport(transport: RealtimeTransport) -> void:
	if _is_initialized:
		LogCore.log_error(_TAG, "set_transport: called after init")
		return
	_transport = transport


## Matches in the match mode and connects with every participant.
static func join_match(mode_id: int) -> MatchJoinResult:
	if not _check("join_match") or not _has_transport("join_match"):
		return _join_result(MatchJoinStatus.FAILED)
	if _state != MatchState.NONE:
		LogCore.log_warn(_TAG, "join_match: a match is in progress")
		return _join_result(MatchJoinStatus.FAILED)
	if _room_waiter != null:
		LogCore.log_warn(_TAG, "join_match: waiting for create_room or join_room")
		return _join_result(MatchJoinStatus.FAILED)
	var origin: MatchOrigin = MatchOrigin.SOLO
	if _room != null:
		if not _is_host():
			LogCore.log_warn(_TAG, "join_match: a non-host room member cannot join a match")
			return _join_result(MatchJoinStatus.FAILED)
		if mode_id != _room.mode_id:
			LogCore.log_warn(_TAG, "join_match: the match mode is not the match mode of the room")
			return _join_result(MatchJoinStatus.FAILED)
		origin = MatchOrigin.ROOM_HOST
	var session: RefCounted = _session
	var waiter: _MATCH_WAITER = _begin_match(origin)
	_set_state(MatchState.MATCHING)
	var token: GetAccessTokenResult = await AuthCore.get_access_token()
	if session != _session:
		return _join_result(MatchJoinStatus.FAILED)
	if waiter.done:
		return waiter.to_result()
	if not token.ok:
		_fail_match(CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, 0, "join_match: no access token", false)
		return waiter.to_result()
	_set_open_op(OpenOp.START_MATCHING, mode_id, "", "")
	_transport.start_matching(mode_id, token.access_token, false)
	return await _wait_match(waiter, session)


## Rejoins the match saved before the app ended.
static func rejoin_match(match_id: String) -> MatchJoinResult:
	if not _check("rejoin_match") or not _has_transport("rejoin_match"):
		return _join_result(MatchJoinStatus.FAILED)
	if _state != MatchState.NONE or _room != null or _room_waiter != null:
		LogCore.log_warn(_TAG, "rejoin_match: a match, a room or a room operation is in progress")
		return _join_result(MatchJoinStatus.FAILED)
	if match_id.is_empty() or match_id != LocalDataCore.get_value_string(LocalDataCore.FileKind.USER, _SAVE_MATCH_ID, ""):
		LogCore.log_warn(_TAG, "rejoin_match: the match ID is not the saved match ID")
		return _join_result(MatchJoinStatus.FAILED)
	var saved: MatchInfo = _load_saved()
	if not _is_valid_info(saved):
		LogCore.log_error(_TAG, "rejoin_match: the saved MatchInfo failed the MatchInfo check")
		_remove_saved()
		return _join_result(MatchJoinStatus.FAILED)
	var session: RefCounted = _session
	var waiter: _MATCH_WAITER = _begin_match(MatchOrigin.REJOIN)
	_info = saved
	_enter_connecting()
	var token: GetAccessTokenResult = await AuthCore.get_access_token()
	if session != _session:
		return _join_result(MatchJoinStatus.FAILED)
	if waiter.done:
		return waiter.to_result()
	if not token.ok:
		_fail_match(CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, 0, "rejoin_match: no access token", false)
		return waiter.to_result()
	_set_open_op(OpenOp.REJOIN, 0, "", match_id)
	_transport.rejoin(match_id, token.access_token)
	return await _wait_match(waiter, session)


## Match ID of the `MatchInfo` saved in the `user` file; an empty string when none is saved.
static func saved_match_id() -> String:
	if not _check("saved_match_id"):
		return ""
	return LocalDataCore.get_value_string(LocalDataCore.FileKind.USER, _SAVE_MATCH_ID, "")


static func leave() -> void:
	if not _check("leave"):
		return
	match _state:
		MatchState.NONE:
			LogCore.log_warn(_TAG, "leave: no match")
		MatchState.MATCHING:
			if _room != null and not _is_host():
				_leave_room_now()
				return
			var waiter: _MATCH_WAITER = _waiter
			_transport.cancel_matching()
			_transport.close()
			_set_none()
			_finish(waiter, MatchJoinStatus.CANCELLED, 0)
		MatchState.CONNECTING:
			var waiter: _MATCH_WAITER = _waiter
			_send_leave_notice(_LEAVE_LEFT)
			_transport.close()
			_set_none()
			_finish(waiter, MatchJoinStatus.CANCELLED, 0)
		MatchState.PLAYING:
			_end_match_now(MatchEndReason.LEFT)


static func end_match() -> void:
	if not _check("end_match"):
		return
	if _state != MatchState.PLAYING:
		LogCore.log_warn(_TAG, "end_match: the match is not Playing")
		return
	_end_match_now(MatchEndReason.ENDED)


static func match_state() -> MatchState:
	if not _check("match_state"):
		return MatchState.NONE
	return _state


static func match_info() -> MatchInfo:
	if not _check("match_info"):
		return MatchInfo.new()
	if _info == null or (_state != MatchState.CONNECTING and _state != MatchState.PLAYING):
		return MatchInfo.new()
	return _info


static func peer_state(participant: int) -> PeerState:
	if not _check("peer_state"):
		return PeerState.LEFT
	if not _in_match() or participant < 0 or participant >= _peer_states.size():
		LogCore.log_error(_TAG, "peer_state: no match or the participant index is out of the list")
		return PeerState.LEFT
	if participant == _info.my_index:
		return PeerState.CONNECTED
	return _peer_states[participant] as PeerState


static func match_time_ms() -> int:
	if not _check("match_time_ms"):
		return _INT64_MIN
	if not _in_match():
		LogCore.log_error(_TAG, "match_time_ms: the match is not Connecting or Playing")
		return _INT64_MIN
	var lockstep_time: int = _transport.lockstep_time()
	if lockstep_time != RealtimeTransport.NO_TIME:
		return lockstep_time
	if not TimeCore.is_synced():
		return _INT64_MIN
	return TimeCore.get_server_time() - _info.start_at


## Sends message bytes to a participant index or to `ALL`.
static func send(target: int, channel: RealtimeChannel, bytes: PackedByteArray) -> bool:
	if not _check("send"):
		return false
	if not _in_match():
		LogCore.log_warn(_TAG, "send: the match is not Connecting or Playing")
		return false
	if channel != RealtimeChannel.RELIABLE and channel != RealtimeChannel.UNRELIABLE:
		LogCore.log_error(_TAG, "send: the channel is not a RealtimeChannel")
		return false
	if target != ALL and (target < 0 or target >= _peer_states.size() or target == _info.my_index):
		LogCore.log_error(_TAG, "send: the target index is out of the list or the own index")
		return false
	if bytes.size() < 1 or bytes.size() > _message_max_bytes:
		LogCore.log_error(_TAG, "send: the message length is out of range")
		return false
	if target != ALL:
		if _peer_states[target] != PeerState.CONNECTED:
			return false
		_fill_send_buffer(bytes)
		return _transport.send_packet(target, channel, _send_buffer)
	_fill_send_buffer(bytes)
	var sent: bool = false
	var all_ok: bool = true
	for i: int in _peer_states.size():
		if i == _info.my_index or _peer_states[i] != PeerState.CONNECTED:
			continue
		sent = true
		if not _transport.send_packet(i, channel, _send_buffer):
			all_ok = false
	return sent and all_ok


static func create_room(mode_id: int) -> RoomResult:
	return await _open_room("create_room", mode_id, "")


static func join_room(room_code: String) -> RoomResult:
	return await _open_room("join_room", 0, room_code)


static func leave_room() -> void:
	if not _check("leave_room"):
		return
	if _room_waiter != null:
		var waiter: _ROOM_WAITER = _room_waiter
		_room_waiter = null
		_change_count += 1
		_transport.leave_room()
		waiter.finish(false, 0)
		return
	if _room == null:
		LogCore.log_warn(_TAG, "leave_room: not in a room")
		return
	_leave_room_now()


static func kick_room_member(user_id: int) -> bool:
	if not _check("kick_room_member"):
		return false
	if _room == null or not _is_host():
		LogCore.log_warn(_TAG, "kick_room_member: not the host of a room")
		return false
	_transport.kick_room_member(user_id)
	return true


static func start_room() -> MatchJoinResult:
	if not _check("start_room") or not _has_transport("start_room"):
		return _join_result(MatchJoinStatus.FAILED)
	if _room == null or not _is_host() or _state != MatchState.NONE:
		LogCore.log_warn(_TAG, "start_room: not the host of a room, or a match is in progress")
		return _join_result(MatchJoinStatus.FAILED)
	var session: RefCounted = _session
	var waiter: _MATCH_WAITER = _begin_match(MatchOrigin.START_ROOM)
	_set_state(MatchState.MATCHING)
	_transport.start_room()
	return await _wait_match(waiter, session)


## Waits for the result of the current match.
static func wait_match() -> MatchJoinResult:
	if not _check("wait_match"):
		return _join_result(MatchJoinStatus.FAILED)
	if (_state != MatchState.MATCHING and _state != MatchState.CONNECTING) or _waiter == null:
		LogCore.log_warn(_TAG, "wait_match: the match is not Matching or Connecting")
		return _join_result(MatchJoinStatus.FAILED)
	return await _wait_match(_waiter, _session)


static func room_info() -> RoomInfo:
	if not _check("room_info"):
		return RoomInfo.new()
	if _room == null:
		return RoomInfo.new()
	return _room


# --- hook ---


## Registers the `on_realtime_message` hook: `(participant: int, channel: RealtimeChannel, bytes: PackedByteArray)`.
## An owner hook: a static func or a `Node` instance method, whose `Node` is the owner.
static func register_on_realtime_message(hook: Callable) -> bool:
	if not _check("register_on_realtime_message"):
		return false
	if hook.is_null() or hook.is_custom():
		LogCore.log_error(_TAG, "register_on_realtime_message: the hook is a lambda or a bound callable")
		return false
	var owner: Object = hook.get_object()
	if not (owner is Script) and not (owner is Node):
		LogCore.log_error(_TAG, "register_on_realtime_message: the hook is not a static func or a Node method")
		return false
	if not is_instance_id_valid(hook.get_object_id()):
		LogCore.log_error(_TAG, "register_on_realtime_message: the owner of the hook is destroyed")
		return false
	if _has_hook():
		LogCore.log_error(_TAG, "register_on_realtime_message: a hook is already registered")
		return false
	_hook = hook
	return true


## Whether a hook is registered. Forgets a hook whose owner is destroyed.
static func _has_hook() -> bool:
	if _hook.is_null():
		return false
	if not is_instance_id_valid(_hook.get_object_id()):
		_hook = _no_hook
		return false
	return true


## Calls the hook with a realtime message. A throw (a GDScript runtime error during the call) logs an error once a
## match; the message is gone and the next message calls the hook again.
static func _call_hook(participant: int, channel: RealtimeChannel, bytes: PackedByteArray) -> void:
	var mark: int = CoreScriptErrors.begin()
	_hook.call(participant, channel, bytes)
	if CoreScriptErrors.end(mark) and not _hook_throw_logged:
		_hook_throw_logged = true
		LogCore.log_error(_TAG, "the on_realtime_message hook threw; later throws in this match are not logged")


# --- frame ---


static func _frame() -> void:
	if not _is_initialized:
		return
	if not _pending.is_empty() and _has_hook():
		_flush_pending()
	_check_time_limits()
	if not _is_initialized:
		return
	_progress_rejoin()
	if _transport == null:
		return
	_transport.poll()
	var none_count: int = _none_count
	var notice: RealtimeNotice = _transport.take_notice()
	while notice != null:
		_handle_notice(notice)
		if not _is_initialized or _transport == null:
			return
		if _none_count != none_count and _state == MatchState.NONE:
			_transport.clear_notices()
			return
		notice = _transport.take_notice()


static func _flush_pending() -> void:
	var count: int = _pending.size()
	for i: int in count:
		if not _has_hook() or i >= _pending.size():
			break
		var message: _PENDING_MESSAGE = _pending[i]
		_call_hook(message.participant, message.channel, message.bytes)
	_pending.clear()


static func _check_time_limits() -> void:
	var now: int = TimeCore.get_monotonic_time()
	if _state == MatchState.CONNECTING:
		if now - _connecting_at >= _connect_timeout_ms:
			_fail_match(CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, 0, "connect time limit", false)
		return
	if _state != MatchState.PLAYING:
		return
	for i: int in _peer_states.size():
		if _state != MatchState.PLAYING:
			return
		if _peer_states[i] == PeerState.DISCONNECTED and now - _lost_at[i] >= _reconnect_timeout_ms:
			_leave_handling(i, PeerLeaveReason.TIMEOUT)


static func _handle_notice(notice: RealtimeNotice) -> void:
	match notice.kind:
		RealtimeNotice.Kind.MATCH_FOUND:
			_on_match_found(notice.match_info)
		RealtimeNotice.Kind.MATCH_FAILED:
			_on_match_failed(notice.fail_reason, notice.error_code)
		RealtimeNotice.Kind.MATCHMAKER_LOST:
			_on_matchmaker_lost(notice.error_code)
		RealtimeNotice.Kind.REJOINED:
			_on_rejoined(notice.ok, notice.left_indices)
		RealtimeNotice.Kind.PEER_CONNECTED:
			_on_peer_connected(notice.participant)
		RealtimeNotice.Kind.PEER_LOST:
			_on_peer_lost(notice.participant)
		RealtimeNotice.Kind.PACKET_RECEIVED:
			_on_packet(notice.participant, notice.channel, notice.packet)
		RealtimeNotice.Kind.ROOM_UPDATED:
			_on_room_updated(notice.room_info)
		RealtimeNotice.Kind.ROOM_FAILED:
			_on_room_failed(notice.error_code, notice.room_request)
		RealtimeNotice.Kind.ROOM_KICKED:
			_on_room_kicked()


# --- match ---


static func _on_match_found(info: MatchInfo) -> void:
	var member_start: bool = _state == MatchState.NONE and _room != null and not _is_host()
	if _state != MatchState.MATCHING and not member_start:
		LogCore.log_warn(_TAG, "match found outside Matching dropped")
		return
	if member_start:
		_begin_match(MatchOrigin.ROOM_MEMBER)
	if _origin == MatchOrigin.ROOM_MEMBER and not _room_started_published:
		_publish_room_match_started()
	if not _is_valid_info(info):
		_fail_match(CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, 0, "match found failed the MatchInfo check", true)
		return
	_info = info._copy()
	_enter_connecting()
	for i: int in _peer_states.size():
		if i != _info.my_index:
			_transport.connect_peer(i)


static func _on_match_failed(reason: CoreContract.MatchFailReason, error_code: int) -> void:
	if _state != MatchState.MATCHING and _state != MatchState.CONNECTING:
		return
	_fail_match(reason, error_code, "match failed", false)


static func _on_rejoined(ok: bool, left_indices: PackedInt32Array) -> void:
	if _state == MatchState.CONNECTING and _origin == MatchOrigin.REJOIN and _open_op == OpenOp.REJOIN:
		_open_op = OpenOp.NONE
		if not ok:
			_fail_match(CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, 0, "rejoin_match: rejoined failed", false)
			return
		for index: int in left_indices:
			if index >= 0 and index < _peer_states.size() and index != _info.my_index:
				_peer_states[index] = PeerState.LEFT
				_transport.close_peer(index)
		var waiting: bool = false
		for i: int in _peer_states.size():
			if i != _info.my_index and _peer_states[i] != PeerState.LEFT:
				waiting = true
				_transport.connect_peer(i)
		if not waiting:
			_enter_playing()
		return
	if _state == MatchState.PLAYING and _rejoin_phase == RejoinPhase.RESULT:
		_open_op = OpenOp.NONE
		_rejoin_phase = RejoinPhase.IDLE
		if not ok:
			LogCore.log_warn(_TAG, "in-match rejoin: rejoined failed")
			return
		for index: int in left_indices:
			if _state != MatchState.PLAYING:
				return
			if index >= 0 and index < _peer_states.size() and index != _info.my_index:
				if _peer_states[index] != PeerState.LEFT:
					_leave_handling(index, PeerLeaveReason.LEFT)


static func _on_peer_connected(participant: int) -> void:
	if not _is_other_participant(participant):
		return
	match _peer_states[participant]:
		PeerState.WAITING:
			_peer_states[participant] = PeerState.CONNECTED
			if _state == MatchState.CONNECTING and _all_connected():
				_enter_playing()
		PeerState.DISCONNECTED:
			_peer_states[participant] = PeerState.CONNECTED
			var event: PeerReconnectedEvent = EventCore.acquire(PeerReconnectedEvent) as PeerReconnectedEvent
			event.participant = participant
			EventCore.publish(event)


static func _on_peer_lost(participant: int) -> void:
	if not _is_other_participant(participant):
		return
	var peer: int = _peer_states[participant]
	if peer == PeerState.LEFT:
		return
	if _state == MatchState.CONNECTING:
		_peer_states[participant] = PeerState.WAITING
		_transport.connect_peer(participant)
		return
	if peer == PeerState.CONNECTED:
		_peer_states[participant] = PeerState.DISCONNECTED
		_lost_at[participant] = TimeCore.get_monotonic_time()
		var event: PeerDisconnectedEvent = EventCore.acquire(PeerDisconnectedEvent) as PeerDisconnectedEvent
		event.participant = participant
		EventCore.publish(event)
		if _state == MatchState.PLAYING and _peer_states[participant] == PeerState.DISCONNECTED:
			_transport.connect_peer(participant)
	elif peer == PeerState.DISCONNECTED:
		_transport.connect_peer(participant)


static func _on_packet(participant: int, channel: RealtimeChannel, packet: PackedByteArray) -> void:
	if not _in_match():
		return
	if participant < 0 or participant >= _peer_states.size() or participant == _info.my_index:
		LogCore.log_warn(_TAG, "packet from a participant index out of the list dropped")
		return
	if _peer_states[participant] == PeerState.LEFT:
		return
	if packet.is_empty() or (packet[0] != _KIND_MESSAGE and packet[0] != _KIND_CONTROL):
		LogCore.log_warn(_TAG, "packet of an unknown kind dropped")
		return
	var kind: int = packet[0]
	if kind == _KIND_CONTROL and channel != RealtimeChannel.RELIABLE:
		LogCore.log_warn(_TAG, "control message on the Unreliable channel dropped")
		return
	var length: int = packet.size() - 1
	if length < 1 or length > _message_max_bytes:
		LogCore.log_warn(_TAG, "packet of a length out of range dropped")
		return
	if kind == _KIND_CONTROL:
		if packet.size() != 3 or packet[1] != _CONTROL_LEAVE or (packet[2] != _LEAVE_LEFT and packet[2] != _LEAVE_ENDED):
			LogCore.log_warn(_TAG, "malformed control message dropped")
			return
		if _state == MatchState.CONNECTING:
			_fail_match(CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, 0, "leave notice in Connecting", false)
			return
		var reason: PeerLeaveReason = PeerLeaveReason.LEFT if packet[2] == _LEAVE_LEFT else PeerLeaveReason.ENDED
		_leave_handling(participant, reason)
		return
	_receive_buffer.resize(length)
	for i: int in length:
		_receive_buffer[i] = packet[i + 1]
	if _has_hook():
		_call_hook(participant, channel, _receive_buffer)
		return
	if _pending.size() >= _pending_max:
		if not _pending_full_logged:
			_pending_full_logged = true
			LogCore.log_error(_TAG, "the pending queue is full; realtime messages are dropped")
		return
	var message: _PENDING_MESSAGE = _PENDING_MESSAGE.new()
	message.participant = participant
	message.channel = channel
	message.bytes = _receive_buffer.duplicate()
	_pending.append(message)


static func _leave_handling(participant: int, reason: PeerLeaveReason) -> void:
	_peer_states[participant] = PeerState.LEFT
	_transport.close_peer(participant)
	var event: PeerLeftEvent = EventCore.acquire(PeerLeftEvent) as PeerLeftEvent
	event.participant = participant
	event.reason = reason
	EventCore.publish(event)


static func _end_match_now(reason: MatchEndReason) -> void:
	_send_leave_notice(_LEAVE_ENDED if reason == MatchEndReason.ENDED else _LEAVE_LEFT)
	_transport.close()
	var match_id: String = _info.match_id
	_set_none()
	var event: MatchEndedEvent = EventCore.acquire(MatchEndedEvent) as MatchEndedEvent
	event.match_id = match_id
	event.reason = reason
	EventCore.publish(event)


## Sends the leave notice to every `Connected` participant.
static func _send_leave_notice(reason: int) -> void:
	_send_buffer.resize(3)
	_send_buffer[0] = _KIND_CONTROL
	_send_buffer[1] = _CONTROL_LEAVE
	_send_buffer[2] = reason
	for i: int in _peer_states.size():
		if i != _info.my_index and _peer_states[i] == PeerState.CONNECTED:
			_transport.send_packet(i, RealtimeChannel.RELIABLE, _send_buffer)


## Fails the current match: `close`, `None`, `Failed`.
static func _fail_match(reason: CoreContract.MatchFailReason, error_code: int, message: String, is_error: bool) -> void:
	if is_error:
		LogCore.log_error(_TAG, message)
	else:
		LogCore.log_warn(_TAG, message)
	var waiter: _MATCH_WAITER = _waiter
	if _transport != null:
		_transport.close()
	_set_none()
	if waiter != null:
		waiter.finish(MatchJoinStatus.FAILED, reason, error_code)


static func _begin_match(origin: MatchOrigin) -> _MATCH_WAITER:
	_waiter = _MATCH_WAITER.new()
	_origin = origin
	_room_started_published = false
	_pending_full_logged = false
	_hook_throw_logged = false
	return _waiter


static func _set_state(state: MatchState) -> void:
	_state = state
	_change_count += 1


static func _enter_connecting() -> void:
	var count: int = _info.user_ids.size()
	_peer_states.resize(count)
	_lost_at.resize(count)
	for i: int in count:
		_peer_states[i] = PeerState.WAITING
		_lost_at[i] = 0
	_connecting_at = TimeCore.get_monotonic_time()
	_set_state(MatchState.CONNECTING)
	_save_info(_info)


static func _enter_playing() -> void:
	_set_state(MatchState.PLAYING)
	if _waiter != null:
		_waiter.finish(MatchJoinStatus.SUCCESS, CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, 0)


## Changes to `None`. Removes the saved `MatchInfo` of a match that reached `Connecting`.
static func _set_none() -> void:
	if _info != null:
		_remove_saved()
	_state = MatchState.NONE
	_none_count += 1
	_change_count += 1
	_origin = MatchOrigin.NONE
	_info = null
	_peer_states.resize(0)
	_lost_at.resize(0)
	_waiter = null
	_room_started_published = false
	_pending.clear()
	_stop_rejoin()


static func _finish(waiter: _MATCH_WAITER, status: MatchJoinStatus, error_code: int) -> void:
	if waiter != null:
		waiter.finish(status, CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, error_code)


static func _wait_match(waiter: _MATCH_WAITER, session: RefCounted) -> MatchJoinResult:
	if not waiter.done:
		await waiter.finished
	if session != _session:
		return _join_result(MatchJoinStatus.FAILED)
	return waiter.to_result()


static func _all_connected() -> bool:
	for i: int in _peer_states.size():
		if i != _info.my_index and _peer_states[i] != PeerState.CONNECTED and _peer_states[i] != PeerState.LEFT:
			return false
	return true


static func _in_match() -> bool:
	return (_state == MatchState.CONNECTING or _state == MatchState.PLAYING) and _info != null


static func _is_other_participant(participant: int) -> bool:
	return _in_match() and participant >= 0 and participant < _peer_states.size() and participant != _info.my_index


## The `MatchInfo` check.
static func _is_valid_info(info: MatchInfo) -> bool:
	if info == null or info.match_id.is_empty():
		return false
	var count: int = info.user_ids.size()
	if count < 2 or info.my_index < 0 or info.my_index >= count:
		return false
	if info.teams.size() != count or info.parties.size() != count:
		return false
	for i: int in count:
		var user_id: int = info.user_ids[i]
		if user_id <= 0:
			return false
		for j: int in i:
			if info.user_ids[j] == user_id:
				return false
	return info.user_ids[info.my_index] == AuthCore.get_user_id()


static func _publish_room_match_started() -> void:
	_room_started_published = true
	var event: RoomMatchStartedEvent = EventCore.acquire(RoomMatchStartedEvent) as RoomMatchStartedEvent
	EventCore.publish(event)


static func _fill_send_buffer(bytes: PackedByteArray) -> void:
	_send_buffer.resize(1)
	_send_buffer[0] = _KIND_MESSAGE
	_send_buffer.append_array(bytes)


# --- matchmaker lost ---


static func _on_matchmaker_lost(error_code: int) -> void:
	if error_code == CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED and _open_op != OpenOp.NONE and not _open_retried:
		_open_retried = true
		_refresh_task.call_deferred(_session, _change_count, error_code)
		return
	if (
		error_code == CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED
		or error_code == CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED
		or error_code == CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED
	):
		NetworkCore.notify_server_error(error_code)
	_process_matchmaker_lost(error_code)


static func _run_token_refresh(session: RefCounted, change_count: int, error_code: int) -> void:
	if session != _session:
		return
	var token: GetAccessTokenResult = await AuthCore.refresh_access_token()
	if session != _session:
		return
	# `MatchState` or the room changed while the refresh waited: that connection is gone, so this matchmaker lost is
	# dropped whatever the refresh result.
	if change_count != _change_count:
		return
	if token.ok:
		_call_open_op(token.access_token)
		return
	_process_matchmaker_lost(error_code)


static func _process_matchmaker_lost(error_code: int) -> void:
	if _room_waiter != null:
		var room_waiter: _ROOM_WAITER = _room_waiter
		_room_waiter = null
		_change_count += 1
		LogCore.log_warn(_TAG, "matchmaker lost while waiting for create_room or join_room")
		room_waiter.finish(false, error_code)
	if _room != null:
		LogCore.log_warn(_TAG, "matchmaker lost in a room")
		_room = null
		_change_count += 1
		_publish_room_changed(RoomChangeReason.LOST)
	match _state:
		MatchState.MATCHING, MatchState.CONNECTING:
			_fail_match(CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, error_code, "matchmaker lost", false)
		MatchState.PLAYING:
			LogCore.log_warn(_TAG, "matchmaker lost in Playing; the match goes on")
			if _rejoin_phase == RejoinPhase.IDLE:
				_rejoin_first = true
				_rejoin_delay_ms = 0
			_rejoin_step(error_code)


static func _set_open_op(op: OpenOp, mode_id: int, room_code: String, match_id: String) -> void:
	_open_op = op
	_open_mode_id = mode_id
	_open_room_code = room_code
	_open_match_id = match_id
	_open_retried = false


## Calls the open operation again with the same input and a new access token.
static func _call_open_op(access_token: String) -> void:
	match _open_op:
		OpenOp.START_MATCHING:
			_transport.start_matching(_open_mode_id, access_token, false)
		OpenOp.OPEN_ROOM:
			_transport.open_room(_open_mode_id, _open_room_code, access_token, false)
		OpenOp.REJOIN:
			_transport.rejoin(_open_match_id, access_token)


# --- in-match rejoin ---


## Step 1 of the in-match rejoin with the last matchmaker lost code.
static func _rejoin_step(error_code: int) -> void:
	if (
		error_code == CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED
		or error_code == CoreContract.CoreError.CORE_ERROR_BANNED
		or error_code == CoreContract.CoreError.CORE_ERROR_MAINTENANCE
		or error_code == CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED
		or error_code == CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED
	):
		_stop_rejoin()
		return
	if _rejoin_first:
		_rejoin_first = false
		_start_rejoin_token()
		return
	if _rejoin_delay_ms == 0:
		_rejoin_delay_ms = _retry_delay_ms
	else:
		var next: int = UtilCore.floor_div(_rejoin_delay_ms * _retry_factor_permille, 1000)
		_rejoin_delay_ms = mini(next, _retry_delay_max_ms)
	_rejoin_at = TimeCore.get_monotonic_time() + _rejoin_delay_ms
	_rejoin_phase = RejoinPhase.DELAY


static func _progress_rejoin() -> void:
	if _rejoin_phase != RejoinPhase.DELAY or _state != MatchState.PLAYING:
		return
	if TimeCore.get_monotonic_time() >= _rejoin_at:
		_start_rejoin_token()


static func _start_rejoin_token() -> void:
	_rejoin_phase = RejoinPhase.TOKEN
	_rejoin_generation += 1
	_rejoin_task.call_deferred(_session, _rejoin_generation)


static func _run_rejoin_token(session: RefCounted, generation: int) -> void:
	if session != _session or generation != _rejoin_generation:
		return
	var token: GetAccessTokenResult = await AuthCore.get_access_token()
	if session != _session or generation != _rejoin_generation:
		return
	if _state != MatchState.PLAYING or _rejoin_phase != RejoinPhase.TOKEN:
		return
	if not token.ok:
		LogCore.log_warn(_TAG, "in-match rejoin: no access token")
		_rejoin_step(0)
		return
	_rejoin_phase = RejoinPhase.RESULT
	_set_open_op(OpenOp.REJOIN, 0, "", _info.match_id)
	_transport.rejoin(_info.match_id, token.access_token)


static func _stop_rejoin() -> void:
	_rejoin_phase = RejoinPhase.IDLE
	_rejoin_generation += 1


# --- room ---


static func _open_room(operation: String, mode_id: int, room_code: String) -> RoomResult:
	if not _check(operation) or not _has_transport(operation):
		return _room_result(false, 0)
	if _room != null or _room_waiter != null or _state != MatchState.NONE:
		LogCore.log_warn(_TAG, "%s: in a room, waiting for a room, or a match is in progress" % operation)
		return _room_result(false, 0)
	var session: RefCounted = _session
	var waiter: _ROOM_WAITER = _ROOM_WAITER.new()
	_room_waiter = waiter
	_change_count += 1
	var token: GetAccessTokenResult = await AuthCore.get_access_token()
	if session != _session:
		return _room_result(false, 0)
	if waiter.done:
		return waiter.to_result()
	if not token.ok:
		LogCore.log_warn(_TAG, "%s: no access token" % operation)
		_room_waiter = null
		_change_count += 1
		waiter.finish(false, 0)
		return waiter.to_result()
	_set_open_op(OpenOp.OPEN_ROOM, mode_id, room_code, "")
	_transport.open_room(mode_id, room_code, token.access_token, false)
	if not waiter.done:
		await waiter.finished
	if session != _session:
		return _room_result(false, 0)
	return waiter.to_result()


static func _on_room_updated(info: RoomInfo) -> void:
	if info == null:
		return
	if _room_waiter != null:
		var waiter: _ROOM_WAITER = _room_waiter
		_room_waiter = null
		_room = info._copy()
		_change_count += 1
		_publish_room_changed(RoomChangeReason.UPDATED)
		waiter.finish(true, 0)
		return
	if _room == null:
		return
	_room = info._copy()
	_change_count += 1
	_publish_room_changed(RoomChangeReason.UPDATED)
	if _room == null:
		return
	# The match of a member is decided by how it started, not by the host of the update: a member that became the host
	# because the host left still cancels the match it started as a member.
	if _state == MatchState.MATCHING and _origin == MatchOrigin.ROOM_MEMBER:
		if _room.status == CoreContract.RoomStatus.ROOM_STATUS_OPEN:
			var waiter: _MATCH_WAITER = _waiter
			_set_none()
			_finish(waiter, MatchJoinStatus.CANCELLED, 0)
	elif _state == MatchState.NONE and not _is_host() and _room.status == CoreContract.RoomStatus.ROOM_STATUS_MATCHING:
		_begin_match(MatchOrigin.ROOM_MEMBER)
		_set_state(MatchState.MATCHING)
		_publish_room_match_started()


static func _on_room_failed(error_code: int, request: RoomRequest) -> void:
	match request:
		RoomRequest.OPEN:
			if _room_waiter != null:
				var waiter: _ROOM_WAITER = _room_waiter
				_room_waiter = null
				_change_count += 1
				LogCore.log_warn(_TAG, "room failed for create_room or join_room")
				waiter.finish(false, error_code)
				return
		RoomRequest.START:
			if _state == MatchState.MATCHING and _origin == MatchOrigin.START_ROOM:
				_fail_match(CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, error_code, "room failed for start_room", false)
				return
		RoomRequest.MATCH:
			if _state == MatchState.MATCHING and _origin == MatchOrigin.ROOM_HOST:
				_fail_match(CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, error_code, "room failed for join_match", false)
				return
	LogCore.log_warn(_TAG, "room failed with no operation to take it")


static func _on_room_kicked() -> void:
	if _room_waiter != null:
		var room_waiter: _ROOM_WAITER = _room_waiter
		_room_waiter = null
		_change_count += 1
		room_waiter.finish(false, 0)
		return
	if _room == null:
		return
	_room = null
	_change_count += 1
	_publish_room_changed(RoomChangeReason.KICKED)
	_cancel_room_matching()


## `leave_room` in a room.
static func _leave_room_now() -> void:
	_transport.leave_room()
	_room = null
	_change_count += 1
	_publish_room_changed(RoomChangeReason.LEFT)
	_cancel_room_matching()


## Ends `Matching` with `close`, `None` and `Cancelled` after leaving the room.
static func _cancel_room_matching() -> void:
	if _state != MatchState.MATCHING:
		return
	var waiter: _MATCH_WAITER = _waiter
	_transport.close()
	_set_none()
	_finish(waiter, MatchJoinStatus.CANCELLED, 0)


static func _publish_room_changed(reason: RoomChangeReason) -> void:
	var event: RoomChangedEvent = EventCore.acquire(RoomChangedEvent) as RoomChangedEvent
	event.room = _room if _room != null else RoomInfo.new()
	event.reason = reason
	EventCore.publish(event)


static func _is_host() -> bool:
	return _room != null and not _room.members.is_empty() and _room.members[0] == AuthCore.get_user_id()


# --- background ---


static func _on_foreground_returned(background_ms: int) -> void:
	if not _is_initialized or background_ms < _background_timeout_ms:
		return
	match _state:
		MatchState.PLAYING:
			_end_match_now(MatchEndReason.BACKGROUND_TIMEOUT)
		MatchState.MATCHING, MatchState.CONNECTING:
			_fail_match(CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, 0, "background time limit", false)


# --- saved MatchInfo ---


static func _save_info(info: MatchInfo) -> void:
	var kind: LocalDataCore.FileKind = LocalDataCore.FileKind.USER
	LocalDataCore.set_value_string(kind, _SAVE_MATCH_ID, info.match_id)
	LocalDataCore.set_value_int(kind, _SAVE_MODE_ID, info.mode_id)
	LocalDataCore.set_value_int(kind, _SAVE_MY_INDEX, info.my_index)
	LocalDataCore.set_array_int(kind, _SAVE_PLAYERS, info.user_ids)
	LocalDataCore.set_array_int(kind, _SAVE_TEAMS, info.teams)
	LocalDataCore.set_array_int(kind, _SAVE_PARTIES, info.parties)
	LocalDataCore.set_value_bool(kind, _SAVE_LOCKSTEP, info.lockstep)
	LocalDataCore.set_value_int(kind, _SAVE_SEED, info.match_seed)
	LocalDataCore.set_value_int(kind, _SAVE_START_AT, info.start_at)


static func _load_saved() -> MatchInfo:
	var kind: LocalDataCore.FileKind = LocalDataCore.FileKind.USER
	var info: MatchInfo = MatchInfo.new()
	info.match_id = LocalDataCore.get_value_string(kind, _SAVE_MATCH_ID, "")
	info.mode_id = LocalDataCore.get_value_int(kind, _SAVE_MODE_ID, 0)
	info.my_index = LocalDataCore.get_value_int(kind, _SAVE_MY_INDEX, 0)
	info.user_ids = LocalDataCore.get_array_int(kind, _SAVE_PLAYERS)
	info.teams = LocalDataCore.get_array_int(kind, _SAVE_TEAMS)
	info.parties = LocalDataCore.get_array_int(kind, _SAVE_PARTIES)
	info.lockstep = LocalDataCore.get_value_bool(kind, _SAVE_LOCKSTEP, false)
	info.match_seed = LocalDataCore.get_value_int(kind, _SAVE_SEED, 0)
	info.start_at = LocalDataCore.get_value_int(kind, _SAVE_START_AT, 0)
	return info


static func _remove_saved() -> void:
	var kind: LocalDataCore.FileKind = LocalDataCore.FileKind.USER
	for key: String in _SAVE_KEYS:
		LocalDataCore.remove_value(kind, key)


# --- helpers ---


static func _check(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, "%s: not initialized" % operation)
	return false


static func _has_transport(operation: String) -> bool:
	if _transport != null:
		return true
	LogCore.log_error(_TAG, "%s: no transport" % operation)
	return false


static func _join_result(status: MatchJoinStatus) -> MatchJoinResult:
	var result: MatchJoinResult = MatchJoinResult.new()
	result.status = status
	return result


static func _room_result(ok: bool, error_code: int) -> RoomResult:
	var result: RoomResult = RoomResult.new()
	result.ok = ok
	result.error_code = error_code
	return result


static func _read_settings() -> bool:
	for key: String in _SETTING_KEYS:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init: setting %s is missing or not an integer" % key)
			return false
	_connect_timeout_ms = CoreSettings.get_int(_KEY_CONNECT_TIMEOUT)
	_reconnect_timeout_ms = CoreSettings.get_int(_KEY_RECONNECT_TIMEOUT)
	_background_timeout_ms = CoreSettings.get_int(_KEY_BACKGROUND_TIMEOUT)
	_message_max_bytes = CoreSettings.get_int(_KEY_MESSAGE_MAX)
	_pending_max = CoreSettings.get_int(_KEY_PENDING_MAX)
	_retry_delay_ms = CoreSettings.get_int(_KEY_RETRY_DELAY)
	_retry_factor_permille = CoreSettings.get_int(_KEY_RETRY_FACTOR)
	_retry_delay_max_ms = CoreSettings.get_int(_KEY_RETRY_DELAY_MAX)
	return true


## `release` and a tree teardown: puts every static var back to its initial value, then tells the transport and the
## waiting operations. The saved `MatchInfo` stays.
static func _teardown() -> void:
	var transport: RealtimeTransport = _transport
	var waiter: _MATCH_WAITER = _waiter
	var room_waiter: _ROOM_WAITER = _room_waiter
	var in_room: bool = _room != null or _room_waiter != null
	_is_initialized = false
	_session = null
	_node = null
	_transport = null
	_connect_timeout_ms = 0
	_reconnect_timeout_ms = 0
	_background_timeout_ms = 0
	_message_max_bytes = 0
	_pending_max = 0
	_retry_delay_ms = 0
	_retry_factor_permille = 0
	_retry_delay_max_ms = 0
	_state = MatchState.NONE
	_origin = MatchOrigin.NONE
	_info = null
	_peer_states = PackedInt32Array()
	_lost_at = PackedInt64Array()
	_connecting_at = 0
	_waiter = null
	_room_started_published = false
	_none_count = 0
	_change_count = 0
	_room = null
	_room_waiter = null
	_hook = Callable()
	_no_hook = Callable()
	_pending = []
	_pending_full_logged = false
	_hook_throw_logged = false
	_send_buffer = PackedByteArray()
	_receive_buffer = PackedByteArray()
	_open_op = OpenOp.NONE
	_open_mode_id = 0
	_open_room_code = ""
	_open_match_id = ""
	_open_retried = false
	_refresh_task = Callable()
	_rejoin_phase = RejoinPhase.IDLE
	_rejoin_first = true
	_rejoin_delay_ms = 0
	_rejoin_at = 0
	_rejoin_generation = 0
	_rejoin_task = Callable()
	if transport != null:
		if in_room:
			transport.leave_room()
		transport.disconnect_all()
		transport.clear_notices()
	if waiter != null:
		waiter.finish(MatchJoinStatus.FAILED, CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED, 0)
	if room_waiter != null:
		room_waiter.finish(false, 0)


static func _on_node_exit_tree(node: Node) -> void:
	if not _is_initialized or node != _node:
		return
	_teardown()
