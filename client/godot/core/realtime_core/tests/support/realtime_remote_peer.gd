class_name RealtimeRemotePeer
extends Node
## Test participant on the other side of a P2P transport connection. Its signals go to the client through the
## `RealtimeFakeMatchmaker` as `PEER_SIGNAL`s from its participant index.
##
## Both sides run on the test host, so the connection uses the loopback address: the IPv4 host candidates this side sends
## and receives get the address `127.0.0.1` (`_loopback`). On the address of the host's network interface, UDP between the
## two processes stopped arriving for whole time windows while several core test runs ran at once, and no connection
## came within the test time limit; on the loopback address it did not.

signal connected

const _SIGNAL := preload("res://core/realtime_core/p2p_signal.gd")

## Participant index of this side.
var index: int = 0
var server: RealtimeFakeMatchmaker = null
var connection: WebRTCPeerConnection = null
var is_open: bool = false
## Offers this side received.
var received_offers: int = 0
## Offers to drop before answering. The candidates that come before the next remote description are dropped too:
## they belong to a dropped offer.
var drop_offers: int = 0
## While `true`, the signals of this side are kept in `held` instead of being sent.
var hold: bool = false
var held: Array[PackedByteArray] = []
## Connection attempt number of the connection: counted from 1 by each `start` that makes an offer, taken from the
## applied offer when this side answers, and 0 before it. The signals this side sends carry it.
var attempt: int = 0
## Signals from the client whose connection attempt number is not that of the connection, dropped. A client that sends
## the right numbers leaves it 0.
var other_attempt_signals: int = 0
## While `true`, the next offer is taken whatever its number, as the P2P transport does after `PEER_REJOINED`.
var take_any_offer: bool = false
## Connection attempt number whose candidates from the client this side drops; 0 drops none. Without the client's
## candidates the connection of that number makes no connectivity check, so it opens no DTLS handshake that dropping
## the connection would cut.
var drop_candidates_of_attempt: int = 0
## Offers this side made, so the next one gets the next number.
var _offers_made: int = 0
var _reliable: WebRTCDataChannel = null
var _unreliable: WebRTCDataChannel = null
var _has_remote_description: bool = false


func start(offerer: bool) -> bool:
	_drop_connection()
	connection = WebRTCPeerConnection.new()
	_has_remote_description = false
	attempt = 0
	if offerer:
		_offers_made += 1
		attempt = _offers_made
	if _initialize(connection) != OK:
		return false
	if connection.session_description_created.connect(_on_session_description_created) != OK:
		return false
	if connection.ice_candidate_created.connect(_on_ice_candidate_created) != OK:
		return false
	_reliable = _channel(connection, 1, true)
	_unreliable = _channel(connection, 2, false)
	if offerer:
		return connection.create_offer() == OK
	return true


## Puts a signal from the client into the connection. An offer with a larger number than that of a connection with a
## remote description is answered on a new connection, as the P2P transport does; a smaller or equal one is dropped
## unless `take_any_offer` is set.
func receive(payload: PackedByteArray) -> void:
	var received: _SIGNAL = _SIGNAL.new()
	if connection == null or not received.read(payload):
		return
	match received.type:
		_SIGNAL.Type.OFFER:
			received_offers += 1
			if drop_offers > 0:
				drop_offers -= 1
				return
			if _has_remote_description:
				if received.attempt <= attempt and not take_any_offer:
					other_attempt_signals += 1
					return
				if not start(false):
					return
			take_any_offer = false
			attempt = received.attempt
			connection.set_remote_description("offer", received.data)
			_has_remote_description = true
		_SIGNAL.Type.ANSWER:
			if received.attempt != attempt:
				other_attempt_signals += 1
				return
			connection.set_remote_description("answer", received.data)
			_has_remote_description = true
		_SIGNAL.Type.CANDIDATE:
			if not _has_remote_description:
				return
			if received.attempt != attempt:
				other_attempt_signals += 1
				return
			if attempt == drop_candidates_of_attempt:
				return
			connection.add_ice_candidate(received.mid, received.index, _loopback(received.data))


## Becomes a restarted app: the connection is closed and the offers count from 1 again. `start` makes the new
## connection.
func restart() -> void:
	_drop_connection()
	_has_remote_description = false
	attempt = 0
	_offers_made = 0


## Sends the held signals and stops holding.
func release_held() -> void:
	hold = false
	for payload: PackedByteArray in held:
		server.send(server.peer_signal(index, payload))
	held.clear()


func close() -> void:
	if connection != null:
		connection.close()


## Held signals of connection attempt `number`, in order. They stay held.
func held_of(number: int) -> Array[_SIGNAL]:
	var found: Array[_SIGNAL] = []
	for payload: PackedByteArray in held:
		var item: _SIGNAL = _SIGNAL.new()
		if item.read(payload) and item.attempt == number:
			found.append(item)
	return found


## Removes the held signals of connection attempt `number`.
func drop_held(number: int) -> void:
	var kept: Array[PackedByteArray] = []
	for payload: PackedByteArray in held:
		var item: _SIGNAL = _SIGNAL.new()
		if not item.read(payload) or item.attempt != number:
			kept.append(payload)
	held = kept


func _process(_delta: float) -> void:
	if connection == null:
		return
	connection.poll()
	var open: bool = (
		_reliable != null and _reliable.get_ready_state() == WebRTCDataChannel.STATE_OPEN
		and _unreliable != null and _unreliable.get_ready_state() == WebRTCDataChannel.STATE_OPEN
	)
	if open and not is_open:
		is_open = true
		connected.emit()
	elif not open:
		is_open = false


func _exit_tree() -> void:
	close()


func _on_session_description_created(type: String, sdp: String) -> void:
	connection.set_local_description(type, sdp)
	var out: _SIGNAL = _SIGNAL.new()
	out.type = _SIGNAL.Type.OFFER if type == "offer" else _SIGNAL.Type.ANSWER
	out.attempt = attempt
	out.data = sdp
	_send(out.to_payload())


func _on_ice_candidate_created(media: String, media_index: int, candidate: String) -> void:
	var out: _SIGNAL = _SIGNAL.new()
	out.type = _SIGNAL.Type.CANDIDATE
	out.attempt = attempt
	out.data = _loopback(candidate)
	out.mid = media
	out.index = media_index
	_send(out.to_payload())


## `candidate` with the address `127.0.0.1` when it is an IPv4 host candidate: `<foundation> <component> <transport>
## <priority> <address> <port> typ host ...`. Other candidates stay as they are.
static func _loopback(candidate: String) -> String:
	var tokens: PackedStringArray = candidate.strip_edges().split(" ", false)
	if tokens.size() < 8 or tokens[6] != "typ" or tokens[7] != "host":
		return candidate
	if not tokens[4].is_valid_ip_address() or tokens[4].contains(":"):
		return candidate
	tokens[4] = "127.0.0.1"
	return " ".join(tokens)


## Closes the connection so that its late signals are not sent.
func _drop_connection() -> void:
	if connection == null:
		return
	if connection.session_description_created.is_connected(_on_session_description_created):
		connection.session_description_created.disconnect(_on_session_description_created)
	if connection.ice_candidate_created.is_connected(_on_ice_candidate_created):
		connection.ice_candidate_created.disconnect(_on_ice_candidate_created)
	connection.close()
	connection = null
	is_open = false


func _send(payload: PackedByteArray) -> void:
	if hold:
		held.append(payload)
	else:
		server.send(server.peer_signal(index, payload))


# ogw:input_boundary
func _initialize(target: WebRTCPeerConnection) -> Error:
	var config: Dictionary = {}
	return target.initialize(config)


# ogw:input_boundary
func _channel(target: WebRTCPeerConnection, id: int, ordered: bool) -> WebRTCDataChannel:
	var options: Dictionary = {"negotiated": true, "id": id, "ordered": ordered}
	if not ordered:
		options["maxRetransmits"] = 0
	var channel: WebRTCDataChannel = target.create_data_channel("test", options)
	if channel != null:
		channel.write_mode = WebRTCDataChannel.WRITE_MODE_BINARY
	return channel
