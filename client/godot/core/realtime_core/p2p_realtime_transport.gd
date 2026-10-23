class_name P2pRealtimeTransport
extends RealtimeTransport
## The P2P transport: the matchmaker connection is the `<server URL>/realtime` WebSocket of the server `matchmaker`
## and `p2p-signaling`, and each pair of participants has one WebRTC connection. The connection addresses and the
## NAT traversal values stay in this object: they are not in `MatchInfo`, events or logs.

const _PEER := preload("res://core/realtime_core/p2p_peer.gd")
const _SIGNAL := preload("res://core/realtime_core/p2p_signal.gd")
const _QUEUED_SIGNAL := preload("res://core/realtime_core/p2p_queued_signal.gd")
const _ICE_SERVER := preload("res://core/realtime_core/p2p_ice_server.gd")
const _TAG: String = "RealtimeCore"
## Polls between giving up a matchmaker connection and sending its close frame, so the frames sent before reach the
## server ahead of the close.
const _CLOSE_DELAY_POLLS: int = 2
## The WebSocket close code the server closes with after `CLOSE`; its reason is the `CLOSE` code.
const _CLOSE_WITH_CODE: int = 4000

var _server_url: String = ""
var _app_version: String = ""
var _relay_only: bool = false

var _socket: WebSocketPeer = null
## Given-up matchmaker connections, polled until their queued frames and their close handshake are sent.
var _closing: Array[WebSocketPeer] = []
## Polls left before the close frame of each connection in `_closing`; 0 once the close started.
var _closing_wait: PackedInt32Array = PackedInt32Array()
var _hello_token: String = ""
var _hello_sent: bool = false
var _hello_acked: bool = false
## Encoded frames waiting for `HELLO_ACK`.
var _outbox: Array[PackedByteArray] = []
## A matchmaker lost to add at the next `poll`.
var _lost_waiting: bool = false
var _lost_code: int = 0
## Whether the client is in a room or opening one.
var _in_room: bool = false

var _match_id: String = ""
var _my_index: int = -1
var _ice_servers: Array[_ICE_SERVER] = []
## Connection of each participant index; `null` when none.
var _peers: Array[_PEER] = []
## 1 for a participant index `connect_peer` was called for.
var _opened: PackedByteArray = PackedByteArray()
## 1 for a participant index `close_peer` closed.
var _closed: PackedByteArray = PackedByteArray()
## Last connection attempt number of each participant index this side sends the offer to; 0 before the first.
var _attempts: PackedInt64Array = PackedInt64Array()
## 1 for a participant index whose `PEER_REJOINED` came after the last offer from it: its next offer is taken whatever
## its number.
var _rejoined: PackedByteArray = PackedByteArray()
## `PEER_SIGNAL`s received before `connect_peer` of their index, in receive order.
var _queued: Array[_QUEUED_SIGNAL] = []
var _frame: CoreContract.MatchmakerFrame = CoreContract.MatchmakerFrame.new()


## `server_url` is the build info server URL, `app_version` the build info app version (empty in a dev run).
func _init(server_url: String, app_version: String, relay_only: bool) -> void:
	super()
	_server_url = server_url
	_app_version = app_version
	_relay_only = relay_only


# --- transport operations ---


func start_matching(mode_id: int, access_token: String, lockstep: bool) -> void:
	_ensure_socket(access_token)
	var frame: CoreContract.MatchmakerFrame = _new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST)
	frame.mode_id = mode_id
	frame.lockstep = lockstep
	_send_frame(frame)


func cancel_matching() -> void:
	_send_frame(_new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_CANCEL))


func rejoin(match_id: String, access_token: String) -> void:
	_close_socket()
	_lost_waiting = false
	_in_room = false
	_open_socket(access_token)
	var frame: CoreContract.MatchmakerFrame = _new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOIN)
	frame.match_id = match_id
	_send_frame(frame)


func connect_peer(index: int) -> void:
	if index < 0 or index >= _peers.size() or index == _my_index or _closed[index] == 1:
		return
	_opened[index] = 1
	_start_peer(index)
	var i: int = 0
	while i < _queued.size():
		var queued: _QUEUED_SIGNAL = _queued[i]
		if queued.participant != index:
			i += 1
			continue
		_queued.remove_at(i)
		var peer: _PEER = _peers[index]
		if peer != null:
			_apply_signal(peer, queued.received)


func send_packet(index: int, channel: RealtimeCore.RealtimeChannel, packet: PackedByteArray) -> bool:
	if index < 0 or index >= _peers.size() or _peers[index] == null:
		return false
	return _peers[index].send(channel, packet)


func close_peer(index: int) -> void:
	if index < 0 or index >= _peers.size():
		return
	_closed[index] = 1
	_rejoined[index] = 0
	_drop_peer(index)
	_drop_queued(index)


func close() -> void:
	if not _match_id.is_empty():
		var frame: CoreContract.MatchmakerFrame = _new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_LEAVE)
		frame.match_id = _match_id
		_send_frame(frame)
	_reset_match()
	if not _in_room:
		_close_socket()


func disconnect_all() -> void:
	_reset_match()
	_in_room = false
	_close_socket()
	_lost_waiting = false


func poll() -> void:
	if _lost_waiting:
		_lost_waiting = false
		add_notice(RealtimeNotice.Kind.MATCHMAKER_LOST).error_code = _lost_code
	_poll_closing()
	_poll_socket()
	for i: int in _peers.size():
		_poll_peer(i)


func open_room(mode_id: int, room_code: String, access_token: String, lockstep: bool) -> void:
	_ensure_socket(access_token)
	_in_room = true
	var frame: CoreContract.MatchmakerFrame = null
	if room_code.is_empty():
		frame = _new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_ROOM_CREATE)
		frame.mode_id = mode_id
	else:
		frame = _new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_ROOM_JOIN)
		frame.room_code = room_code
	frame.lockstep = lockstep
	_send_frame(frame)


func leave_room() -> void:
	_send_frame(_new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_ROOM_LEAVE))
	_in_room = false
	if _match_id.is_empty():
		_close_socket()


func kick_room_member(user_id: int) -> void:
	var frame: CoreContract.MatchmakerFrame = _new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_ROOM_KICK)
	frame.user_id = user_id
	_send_frame(frame)


func start_room() -> void:
	_send_frame(_new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_ROOM_START))


# --- matchmaker connection ---


func _ensure_socket(access_token: String) -> void:
	if _socket == null:
		_lost_waiting = false
		_open_socket(access_token)


func _open_socket(access_token: String) -> void:
	_socket = WebSocketPeer.new()
	_hello_token = access_token
	_hello_sent = false
	_hello_acked = false
	_outbox.clear()
	if _socket.connect_to_url(_realtime_url()) != OK:
		_drop_socket(0)


## Closes the matchmaker connection without a notification. The frames sent before go out first.
func _close_socket() -> void:
	if _socket != null:
		_closing.append(_socket)
		_closing_wait.append(_CLOSE_DELAY_POLLS)
	_socket = null
	_hello_token = ""
	_hello_sent = false
	_hello_acked = false
	_outbox.clear()


## Closes the matchmaker connection and adds a matchmaker lost at the next `poll`.
func _drop_socket(code: int) -> void:
	_close_socket()
	_in_room = false
	_lost_waiting = true
	_lost_code = code


func _poll_socket() -> void:
	if _socket == null:
		return
	_socket.poll()
	var state: WebSocketPeer.State = _socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN and not _hello_sent:
		_hello_sent = true
		var hello: CoreContract.MatchmakerFrame = _new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_HELLO)
		hello.access_token = _hello_token
		hello.data_version = DataCore.get_data_version()
		hello.client_version = _app_version
		_hello_token = ""
		if _socket.send(hello.encode(), WebSocketPeer.WRITE_MODE_BINARY) != OK:
			_drop_socket(0)
			_add_lost_now()
			return
	while _socket != null and _socket.get_available_packet_count() > 0:
		_on_frame(_socket.get_packet())
	if _socket != null and _socket.get_ready_state() == WebSocketPeer.STATE_CLOSED:
		_drop_socket(_closed_code(_socket))
		_add_lost_now()


## The matchmaker lost code of a connection that closed without a `CLOSE` it read: the decimal reason of close code
## 4000, else 0. The engine drops a `CLOSE` frame that came with the close, and the close still carries its code.
static func _closed_code(socket: WebSocketPeer) -> int:
	var reason: String = socket.get_close_reason()
	if socket.get_close_code() != _CLOSE_WITH_CODE or not reason.is_valid_int():
		return 0
	return reason.to_int()


func _poll_closing() -> void:
	var i: int = 0
	while i < _closing.size():
		var socket: WebSocketPeer = _closing[i]
		socket.poll()
		if _closing_wait[i] > 0:
			_closing_wait[i] -= 1
			if _closing_wait[i] == 0:
				socket.close()
		if socket.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			_closing.remove_at(i)
			_closing_wait.remove_at(i)
		else:
			i += 1


func _add_lost_now() -> void:
	if _lost_waiting:
		_lost_waiting = false
		add_notice(RealtimeNotice.Kind.MATCHMAKER_LOST).error_code = _lost_code


func _on_frame(bytes: PackedByteArray) -> void:
	var frame: CoreContract.MatchmakerFrame = _frame
	if not frame.decode(bytes):
		LogCore.log_warn(_TAG, "malformed matchmaker frame dropped")
		return
	match frame.kind:
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_HELLO_ACK:
			_hello_acked = true
			for queued: PackedByteArray in _outbox:
				if _socket == null or _socket.send(queued, WebSocketPeer.WRITE_MODE_BINARY) != OK:
					break
			_outbox.clear()
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_CLOSE:
			_drop_socket(frame.code)
			_add_lost_now()
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_FAILED:
			var failed: RealtimeNotice = add_notice(RealtimeNotice.Kind.MATCH_FAILED)
			failed.fail_reason = frame.reason
			failed.error_code = frame.error_code
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_FOUND:
			_on_match_found(frame)
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED:
			_on_match_rejoined(frame)
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL:
			_on_peer_signal(frame.index, frame.payload)
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_REJOINED:
			_on_peer_rejoined(frame.index)
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_ROOM_STATE:
			var room: RoomInfo = RoomInfo.new()
			room.room_code = frame.room_code
			room.mode_id = frame.mode_id
			room.members = frame.room_members.duplicate()
			room.status = frame.room_status
			add_notice(RealtimeNotice.Kind.ROOM_UPDATED).room_info = room
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_ROOM_FAILED:
			var room_failed: RealtimeNotice = add_notice(RealtimeNotice.Kind.ROOM_FAILED)
			room_failed.error_code = frame.error_code
			room_failed.room_request = _room_request(frame.request)
			if room_failed.room_request == RealtimeCore.RoomRequest.OPEN:
				_in_room = false
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_ROOM_KICKED:
			add_notice(RealtimeNotice.Kind.ROOM_KICKED)
			_in_room = false
			if _match_id.is_empty():
				_close_socket()


func _on_match_found(frame: CoreContract.MatchmakerFrame) -> void:
	if not _read_ice_servers(frame.transport):
		var leave: CoreContract.MatchmakerFrame = _new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_LEAVE)
		leave.match_id = frame.match_id
		_send_frame(leave)
		var failed: RealtimeNotice = add_notice(RealtimeNotice.Kind.MATCH_FAILED)
		failed.fail_reason = CoreContract.MatchFailReason.MATCH_FAIL_REASON_CREATE_FAILED
		failed.error_code = 0
		return
	var info: MatchInfo = _read_players(frame)
	info.match_id = frame.match_id
	info.mode_id = frame.mode_id
	info.my_index = frame.my_index
	info.match_seed = frame.seed
	info.start_at = frame.start_at
	info.lockstep = frame.lockstep
	_start_match(frame.match_id, frame.my_index, info.user_ids.size())
	add_notice(RealtimeNotice.Kind.MATCH_FOUND).match_info = info


func _on_match_rejoined(frame: CoreContract.MatchmakerFrame) -> void:
	var rejoined: RealtimeNotice = add_notice(RealtimeNotice.Kind.REJOINED)
	if not frame.ok or not _read_ice_servers(frame.transport):
		rejoined.ok = false
		return
	if _match_id != frame.match_id or _peers.size() != frame.players.size():
		_start_match(frame.match_id, frame.my_index, frame.players.size())
	else:
		_restart_offers(frame.left_indices)
	rejoined.ok = true
	rejoined.left_indices = frame.left_indices.duplicate()


## Reads the ICE servers. Returns `false` when the transport is relay-only and has no relay.
func _read_ice_servers(transport: CoreContract.Transport) -> bool:
	_ice_servers.clear()
	if transport == null:
		return not _relay_only
	if _relay_only and transport.relays.is_empty():
		return false
	if not _relay_only and not transport.stun_urls.is_empty():
		var stun: _ICE_SERVER = _ICE_SERVER.new()
		stun.urls = transport.stun_urls.duplicate()
		_ice_servers.append(stun)
	for relay: CoreContract.TransportRelay in transport.relays:
		var server: _ICE_SERVER = _ICE_SERVER.new()
		server.urls = PackedStringArray([relay.url])
		server.username = relay.username
		server.credential = relay.credential
		_ice_servers.append(server)
	return true


## A `MatchInfo` with the participant lists of `frame` in index order.
func _read_players(frame: CoreContract.MatchmakerFrame) -> MatchInfo:
	var info: MatchInfo = MatchInfo.new()
	var count: int = frame.players.size()
	info.user_ids.resize(count)
	info.teams.resize(count)
	info.parties.resize(count)
	var by_index: bool = true
	for player: CoreContract.MatchPlayer in frame.players:
		if player == null or player.index < 0 or player.index >= count:
			by_index = false
	for i: int in count:
		var player: CoreContract.MatchPlayer = frame.players[i]
		if player == null:
			continue
		var slot: int = player.index if by_index else i
		info.user_ids[slot] = player.user_id
		info.teams[slot] = player.team
		info.parties[slot] = player.party
	return info


func _start_match(match_id: String, my_index: int, count: int) -> void:
	_reset_match()
	_match_id = match_id
	_my_index = my_index
	_peers.resize(count)
	_opened.resize(count)
	_closed.resize(count)
	_attempts.resize(count)
	_rejoined.resize(count)
	for i: int in count:
		_peers[i] = null
		_opened[i] = 0
		_closed[i] = 0
		_attempts[i] = 0
		_rejoined[i] = 0


func _reset_match() -> void:
	for i: int in _peers.size():
		_drop_peer(i)
	_match_id = ""
	_my_index = -1
	_peers.clear()
	_opened.resize(0)
	_closed.resize(0)
	_attempts.resize(0)
	_rejoined.resize(0)
	_queued.clear()


# --- P2P connections ---


func _start_peer(index: int) -> void:
	var replaced: _PEER = _peers[index]
	var replaces_connected: bool = (
		replaced != null and (replaced.status == _PEER.Status.CONNECTED or replaced.replaces_connected)
	)
	_drop_peer(index)
	var peer: _PEER = _PEER.new()
	peer.replaces_connected = replaces_connected
	_peers[index] = peer
	if _my_index < index:
		_attempts[index] += 1
		peer.attempt = _attempts[index]
	if not peer.start(index, _my_index, _ice_servers, _relay_only):
		peer.status = _PEER.Status.LOST


## After a rejoin into the same match, starts a new connection with each participant this side offers to whose
## connection is not connected: the signals of that connection sent while the matchmaker connection was gone were
## dropped, and the other side waits for an offer. A participant in `left_indices` gets no offer.
func _restart_offers(left_indices: PackedInt32Array) -> void:
	for index: int in _peers.size():
		var peer: _PEER = _peers[index]
		if peer == null or not peer.is_offerer or peer.status == _PEER.Status.CONNECTED or left_indices.has(index):
			continue
		_start_peer(index)
		_send_signals(_peers[index])


func _drop_peer(index: int) -> void:
	if index < 0 or index >= _peers.size():
		return
	var peer: _PEER = _peers[index]
	if peer != null:
		peer.close()
	_peers[index] = null


func _drop_queued(index: int) -> void:
	var i: int = 0
	while i < _queued.size():
		if _queued[i].participant == index:
			_queued.remove_at(i)
		else:
			i += 1


func _poll_peer(index: int) -> void:
	if index >= _peers.size():
		return
	var peer: _PEER = _peers[index]
	if peer == null:
		return
	var before: _PEER.Status = peer.status
	peer.poll()
	_send_signals(peer)
	if _closed[index] == 1:
		return
	if peer.status != before:
		if peer.status == _PEER.Status.CONNECTED:
			if not peer.replaces_connected:
				add_notice(RealtimeNotice.Kind.PEER_CONNECTED).participant = index
		elif peer.status == _PEER.Status.LOST:
			peer.close()
			_peers[index] = null
			add_notice(RealtimeNotice.Kind.PEER_LOST).participant = index
			return
	if peer.status == _PEER.Status.CONNECTED:
		_read_packets(index, peer.reliable, RealtimeCore.RealtimeChannel.RELIABLE)
		_read_packets(index, peer.unreliable, RealtimeCore.RealtimeChannel.UNRELIABLE)


func _read_packets(index: int, channel: WebRTCDataChannel, kind: RealtimeCore.RealtimeChannel) -> void:
	if channel == null:
		return
	while channel.get_available_packet_count() > 0:
		var received: RealtimeNotice = add_notice(RealtimeNotice.Kind.PACKET_RECEIVED)
		received.participant = index
		received.channel = kind
		received.packet = channel.get_packet()


func _send_signals(peer: _PEER) -> void:
	if peer.outgoing.is_empty():
		return
	for signal_out: _SIGNAL in peer.outgoing:
		var frame: CoreContract.MatchmakerFrame = _new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL)
		frame.index = peer.index
		frame.payload = signal_out.to_payload()
		_send_frame(frame)
	peer.outgoing.clear()


func _on_peer_signal(index: int, payload: PackedByteArray) -> void:
	if index < 0 or index >= _peers.size() or index == _my_index or _closed[index] == 1:
		return
	var received: _SIGNAL = _SIGNAL.new()
	if not received.read(payload):
		LogCore.log_warn(_TAG, "malformed PEER_SIGNAL payload dropped")
		return
	var peer: _PEER = _peers[index]
	if peer == null:
		var queued: _QUEUED_SIGNAL = _QUEUED_SIGNAL.new()
		queued.participant = index
		queued.received = received
		_queued.append(queued)
		return
	_apply_signal(peer, received)


func _apply_signal(peer: _PEER, received: _SIGNAL) -> void:
	if received.type == _SIGNAL.Type.OFFER:
		if peer.is_offerer:
			return
		var index: int = peer.index
		# After `PEER_REJOINED` the other side may be a restarted app that counts from 1 again; the server sends no signal
		# of the earlier connection after it.
		if _rejoined[index] == 0 and received.attempt <= peer.attempt:
			LogCore.log_warn(_TAG, "PEER_SIGNAL offer of the current or an earlier connection attempt dropped")
			return
		_rejoined[index] = 0
		if peer.attempt != 0:
			# The other side started a new connection: answer it on a new connection.
			_start_peer(index)
			peer = _peers[index]
		peer.attempt = received.attempt
	elif received.attempt != peer.attempt:
		LogCore.log_warn(_TAG, "PEER_SIGNAL of another connection attempt dropped")
		return
	peer.apply(received)
	_send_signals(peer)


func _on_peer_rejoined(index: int) -> void:
	if index < 0 or index >= _peers.size() or index == _my_index or _closed[index] == 1 or _opened[index] == 0:
		return
	_rejoined[index] = 1
	var peer: _PEER = _peers[index]
	# A restarted app does not continue its earlier connection: the offering side replaces a connected one with the next
	# number, and the answering side only takes the next offer whatever its number.
	if peer != null and peer.status == _PEER.Status.CONNECTED and _my_index > index:
		return
	_start_peer(index)
	_send_signals(_peers[index])


# --- helpers ---


func _new_frame(kind: CoreContract.MatchmakerFrameKind) -> CoreContract.MatchmakerFrame:
	var frame: CoreContract.MatchmakerFrame = CoreContract.MatchmakerFrame.new()
	frame.kind = kind
	return frame


## Sends a frame now after `HELLO_ACK`, or keeps it until `HELLO_ACK`.
func _send_frame(frame: CoreContract.MatchmakerFrame) -> void:
	if _socket == null:
		return
	var bytes: PackedByteArray = frame.encode()
	if not _hello_acked:
		_outbox.append(bytes)
		return
	if _socket.send(bytes, WebSocketPeer.WRITE_MODE_BINARY) != OK:
		_drop_socket(0)


func _realtime_url() -> String:
	var base: String = _server_url
	while base.ends_with("/"):
		base = base.substr(0, base.length() - 1)
	if base.begins_with("https://"):
		base = "wss://" + base.substr(8)
	elif base.begins_with("http://"):
		base = "ws://" + base.substr(7)
	return base + "/realtime"


func _room_request(kind: CoreContract.MatchmakerFrameKind) -> RealtimeCore.RoomRequest:
	match kind:
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_ROOM_KICK:
			return RealtimeCore.RoomRequest.KICK
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_ROOM_START:
			return RealtimeCore.RoomRequest.START
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST:
			return RealtimeCore.RoomRequest.MATCH
	return RealtimeCore.RoomRequest.OPEN

