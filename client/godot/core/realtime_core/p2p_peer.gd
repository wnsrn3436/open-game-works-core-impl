extends RefCounted
## One WebRTC connection of the P2P transport with one participant: one connection with the `Reliable` channel
## (ordered, reliable) and the `Unreliable` channel (unordered, no retransmit).

enum Status { CONNECTING, CONNECTED, LOST }

const _SIGNAL := preload("res://core/realtime_core/p2p_signal.gd")
const _ICE_SERVER := preload("res://core/realtime_core/p2p_ice_server.gd")
const _RELIABLE_ID: int = 1
const _UNRELIABLE_ID: int = 2

## Participant index of the other side.
var index: int = 0
var status: Status = Status.CONNECTING
var connection: WebRTCPeerConnection = null
var reliable: WebRTCDataChannel = null
var unreliable: WebRTCDataChannel = null
## Signals to send to the other side, in order. The transport sends and clears them after each `poll`.
var outgoing: Array[_SIGNAL] = []
## Received ICE candidates waiting for the remote description.
var waiting_candidates: Array[_SIGNAL] = []
var has_remote: bool = false
## Whether this side sends the offer: the side with the smaller index.
var is_offerer: bool = false
## Connection attempt number of this connection, carried by the signals it sends. The offering side sets it before
## `start`; the answering side takes it from the offer it applies, and it is 0 until then.
var attempt: int = 0
## Whether this connection replaced a connected connection with the same participant. The participant stays connected
## while it connects, so its connect adds no peer connected.
var replaces_connected: bool = false
## Count of received ICE candidates put into the connection. Read by the core tests.
var added_candidates: int = 0
var _relay_only: bool = false


## Starts the connection with the ICE servers. Returns `false` when the engine could not start it.
func start(other_index: int, my_index: int, ice_servers: Array[_ICE_SERVER], relay_only: bool) -> bool:
	index = other_index
	is_offerer = my_index < other_index
	_relay_only = relay_only
	connection = WebRTCPeerConnection.new()
	if _initialize(connection, ice_servers) != OK:
		return false
	if connection.session_description_created.connect(_on_session_description_created) != OK:
		return false
	if connection.ice_candidate_created.connect(_on_ice_candidate_created) != OK:
		return false
	reliable = _create_channel(connection, "reliable", _RELIABLE_ID, true)
	unreliable = _create_channel(connection, "unreliable", _UNRELIABLE_ID, false)
	if reliable == null or unreliable == null:
		return false
	reliable.write_mode = WebRTCDataChannel.WRITE_MODE_BINARY
	unreliable.write_mode = WebRTCDataChannel.WRITE_MODE_BINARY
	if is_offerer and connection.create_offer() != OK:
		return false
	return true


## Puts a received signal into the connection.
func apply(received: _SIGNAL) -> void:
	if connection == null:
		return
	match received.type:
		_SIGNAL.Type.OFFER, _SIGNAL.Type.ANSWER:
			var sdp: String = received.data
			if _relay_only:
				sdp = _SIGNAL.relay_sdp(sdp)
			var type_text: String = "offer" if received.type == _SIGNAL.Type.OFFER else "answer"
			if connection.set_remote_description(type_text, sdp) != OK:
				status = Status.LOST
				return
			has_remote = true
			for candidate: _SIGNAL in waiting_candidates:
				_add_candidate(candidate)
			waiting_candidates.clear()
		_SIGNAL.Type.CANDIDATE:
			if _relay_only and not _SIGNAL.is_relay_candidate(received.data):
				return
			if not has_remote:
				waiting_candidates.append(received)
				return
			_add_candidate(received)


## Reads the connection and updates `status`.
func poll() -> void:
	if connection == null or status == Status.LOST:
		return
	connection.poll()
	var state: WebRTCPeerConnection.ConnectionState = connection.get_connection_state()
	if state == WebRTCPeerConnection.STATE_FAILED or state == WebRTCPeerConnection.STATE_CLOSED:
		status = Status.LOST
		return
	if status == Status.CONNECTED:
		if state == WebRTCPeerConnection.STATE_DISCONNECTED or not _is_open(reliable) or not _is_open(unreliable):
			status = Status.LOST
		return
	if _is_open(reliable) and _is_open(unreliable):
		status = Status.CONNECTED


## Sends a packet on the channel. Returns `false` when the channel is not open or the engine refused it.
func send(channel: RealtimeCore.RealtimeChannel, packet: PackedByteArray) -> bool:
	var target: WebRTCDataChannel = reliable if channel == RealtimeCore.RealtimeChannel.RELIABLE else unreliable
	if status != Status.CONNECTED or not _is_open(target):
		return false
	return target.put_packet(packet) == OK


## Closes the connection. The other side sees it lost.
func close() -> void:
	if connection != null:
		if connection.session_description_created.is_connected(_on_session_description_created):
			connection.session_description_created.disconnect(_on_session_description_created)
		if connection.ice_candidate_created.is_connected(_on_ice_candidate_created):
			connection.ice_candidate_created.disconnect(_on_ice_candidate_created)
		connection.close()
	connection = null
	reliable = null
	unreliable = null
	status = Status.LOST
	outgoing.clear()
	waiting_candidates.clear()


func _on_session_description_created(type: String, sdp: String) -> void:
	if connection == null:
		return
	if connection.set_local_description(type, sdp) != OK:
		status = Status.LOST
		return
	var signal_out: _SIGNAL = _SIGNAL.new()
	signal_out.type = _SIGNAL.Type.OFFER if type == "offer" else _SIGNAL.Type.ANSWER
	signal_out.attempt = attempt
	signal_out.data = _SIGNAL.relay_sdp(sdp) if _relay_only else sdp
	outgoing.append(signal_out)


func _on_ice_candidate_created(media: String, media_index: int, candidate: String) -> void:
	if _relay_only and not _SIGNAL.is_relay_candidate(candidate):
		return
	var signal_out: _SIGNAL = _SIGNAL.new()
	signal_out.type = _SIGNAL.Type.CANDIDATE
	signal_out.attempt = attempt
	signal_out.data = candidate
	signal_out.mid = media
	signal_out.index = media_index
	outgoing.append(signal_out)


func _add_candidate(candidate: _SIGNAL) -> void:
	if connection.add_ice_candidate(candidate.mid, candidate.index, candidate.data) == OK:
		added_candidates += 1


func _is_open(channel: WebRTCDataChannel) -> bool:
	return channel != null and channel.get_ready_state() == WebRTCDataChannel.STATE_OPEN


# ogw:input_boundary
func _initialize(target: WebRTCPeerConnection, ice_servers: Array[_ICE_SERVER]) -> Error:
	var servers: Array = []
	for server: _ICE_SERVER in ice_servers:
		var urls: Array = []
		for url: String in server.urls:
			urls.append(url)
		var entry: Dictionary = {"urls": urls}
		if not server.username.is_empty() or not server.credential.is_empty():
			entry["username"] = server.username
			entry["credential"] = server.credential
		servers.append(entry)
	var config: Dictionary = {"iceServers": servers}
	return target.initialize(config)


# ogw:input_boundary
func _create_channel(target: WebRTCPeerConnection, label: String, id: int, ordered: bool) -> WebRTCDataChannel:
	var options: Dictionary = {"negotiated": true, "id": id, "ordered": ordered}
	if not ordered:
		options["maxRetransmits"] = 0
	return target.create_data_channel(label, options)
