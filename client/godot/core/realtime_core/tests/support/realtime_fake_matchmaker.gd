class_name RealtimeFakeMatchmaker
extends Node
## Test matchmaker: a WebSocket relay of the test host (`UnitTestCore.open_ws_relay`) whose control connection this node
## reads every frame. The transport connects to the relay through the real `WebSocketPeer`, which in the browser run is
## the browser's `WebSocket`. It answers `HELLO` with `HELLO_ACK`, answers `MATCH_REQUEST` with `match_reply` when it
## is set, and passes the `PEER_SIGNAL`s for a participant index to the `RealtimeRemotePeer` of that index. Frames go to
## the newest client connection.

const _SIGNAL := preload("res://core/realtime_core/p2p_signal.gd")

## Frames received, in order.
var received: Array[CoreContract.MatchmakerFrame] = []
## `PEER_SIGNAL`s of the client whose `payload` is malformed, a missing or invalid connection attempt number among
## them. A client that sends well-formed signals leaves it 0.
var malformed_signals: int = 0
## Remote participants by participant index.
var remotes: Dictionary[int, RealtimeRemotePeer] = {}
## TURN URL of the relay `match_found` puts in the transport.
var relay_url: String = "turn:127.0.0.1:3478"
## Frame sent for each `MATCH_REQUEST`; `null` to send nothing.
var match_reply: CoreContract.MatchmakerFrame = null
## Client connections the relay told of.
var accepted_count: int = 0
## Client connections that closed.
var closed_count: int = 0
## Messages of the relay `error` events, in order.
var relay_errors: PackedStringArray = PackedStringArray()
var _control: WebSocketPeer = null
var _base_url: String = ""
## Relay number of the newest client connection; 0 when it closed or none came.
var _conn: int = 0


## Opens a relay and connects its control. Whether the control is open. Async.
func start() -> bool:
	var relay: UnitTestWsRelay = await UnitTestCore.open_ws_relay()
	if relay.url.is_empty():
		return false
	var control: WebSocketPeer = WebSocketPeer.new()
	if control.connect_to_url(relay.control_url) != OK:
		return false
	_control = control
	# The transport's `<server URL>/realtime` becomes the client URL with the path `/realtime`.
	_base_url = "http://" + relay.url.substr("ws://".length())
	# A release of the modules, as at the test time limit, ends the wait too.
	while (
		is_inside_tree() and _control == control and control.get_ready_state() == WebSocketPeer.STATE_CONNECTING
		and EventCore.is_initialized()
	):
		await (Engine.get_main_loop() as SceneTree).process_frame
	return control.get_ready_state() == WebSocketPeer.STATE_OPEN


## Server URL of the transport.
func base_url() -> String:
	return _base_url


func _process(_delta: float) -> void:
	poll()


func _exit_tree() -> void:
	if _control != null:
		_control.close()
	_control = null


func poll() -> void:
	if _control == null:
		return
	_control.poll()
	while _control != null and _control.get_available_packet_count() > 0:
		_on_event(_control.get_packet())


func send(frame: CoreContract.MatchmakerFrame) -> void:
	_command('{"op": "send", "conn": %d, "binary": true, "data": "%s"}' % [_conn, Marshalls.raw_to_base64(frame.encode())])


## Sends `CLOSE` with `code` and closes the connection at once with close code 4000 and `code` as the reason, as the
## server `matchmaker` does.
func send_close(code: int) -> void:
	var frame: CoreContract.MatchmakerFrame = new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_CLOSE)
	frame.code = code
	send(frame)
	close_connection(4000, str(code))


## Closes the connection without `CLOSE`.
func drop() -> void:
	close_connection(1000, "")


## Closes the connection with a WebSocket close `code` and `reason`, without `CLOSE`.
func close_connection(code: int, reason: String) -> void:
	_command('{"op": "close", "conn": %d, "code": %d, "reason": %s}' % [_conn, code, JSON.stringify(reason)])


func _command(text: String) -> void:
	if _conn == 0 or _control == null or _control.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	_control.send_text(text)


# ogw:input_boundary
func _on_event(bytes: PackedByteArray) -> void:
	var parsed: Variant = JSON.parse_string(bytes.get_string_from_utf8())
	if not parsed is Dictionary:
		relay_errors.append("a relay event that is not a JSON object")
		return
	var event: Dictionary = parsed
	var conn_value: Variant = event.get("conn", 0.0)
	var conn: int = 0
	if conn_value is float:
		var number: float = conn_value
		conn = int(number)
	match event.get("event", ""):
		"open":
			_conn = conn
			accepted_count += 1
		"close":
			closed_count += 1
			if conn == _conn:
				_conn = 0
		"message":
			var data: Variant = event.get("data", "")
			if event.get("binary", false) == true and data is String:
				var frame: CoreContract.MatchmakerFrame = CoreContract.MatchmakerFrame.new()
				if frame.decode(Marshalls.base64_to_raw(str(data))):
					_on_frame(frame)
		"error":
			relay_errors.append(str(event.get("message", "")))


func count(kind: CoreContract.MatchmakerFrameKind) -> int:
	var found: int = 0
	for frame: CoreContract.MatchmakerFrame in received:
		if frame.kind == kind:
			found += 1
	return found


## Frames of `kind`, in order.
func frames_of(kind: CoreContract.MatchmakerFrameKind) -> Array[CoreContract.MatchmakerFrame]:
	var found: Array[CoreContract.MatchmakerFrame] = []
	for frame: CoreContract.MatchmakerFrame in received:
		if frame.kind == kind:
			found.append(frame)
	return found


## Waits until `n` frames of `kind` came. Waits on the frames of the scene tree, so the test that resumes can free
## this node. A release of the modules, as at the test time limit, ends the wait too.
func wait_count(kind: CoreContract.MatchmakerFrameKind, n: int) -> void:
	while count(kind) < n and EventCore.is_initialized():
		await (Engine.get_main_loop() as SceneTree).process_frame


## Waits until the connection closed `n` times. Ends like `wait_count`.
func wait_closed(n: int) -> void:
	while closed_count < n and EventCore.is_initialized():
		await (Engine.get_main_loop() as SceneTree).process_frame


func new_frame(kind: CoreContract.MatchmakerFrameKind) -> CoreContract.MatchmakerFrame:
	var frame: CoreContract.MatchmakerFrame = CoreContract.MatchmakerFrame.new()
	frame.kind = kind
	return frame


## A `MATCH_FOUND` of `user_ids` where the client is `my_index`. With `relays`, the transport has one relay.
func match_found(user_ids: PackedInt64Array, my_index: int, relays: bool) -> CoreContract.MatchmakerFrame:
	var frame: CoreContract.MatchmakerFrame = new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_FOUND)
	frame.match_id = "match-p2p"
	frame.mode_id = 7
	frame.my_index = my_index
	frame.seed = 99
	frame.start_at = 1700000600000
	for i: int in user_ids.size():
		var player: CoreContract.MatchPlayer = CoreContract.MatchPlayer.new()
		player.user_id = user_ids[i]
		player.index = i
		frame.players.append(player)
	frame.transport = CoreContract.Transport.new()
	frame.transport.kind = CoreContract.TransportKind.TRANSPORT_KIND_P2_P
	if relays:
		var relay: CoreContract.TransportRelay = CoreContract.TransportRelay.new()
		relay.url = relay_url
		relay.username = "relay-user-secret-name"
		relay.credential = "relay-credential-secret"
		frame.transport.relays.append(relay)
	return frame


## A `PEER_SIGNAL` from participant `index` with `payload`.
func peer_signal(index: int, payload: PackedByteArray) -> CoreContract.MatchmakerFrame:
	var frame: CoreContract.MatchmakerFrame = new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL)
	frame.index = index
	frame.payload = payload
	return frame


func _on_frame(frame: CoreContract.MatchmakerFrame) -> void:
	received.append(frame)
	match frame.kind:
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_HELLO:
			send(new_frame(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_HELLO_ACK))
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST:
			if match_reply != null:
				send(match_reply)
		CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL:
			if not _SIGNAL.new().read(frame.payload):
				malformed_signals += 1
			if remotes.has(frame.index):
				remotes[frame.index].receive(frame.payload)
