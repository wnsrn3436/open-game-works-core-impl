extends RefCounted
## Automation channel connection of `QACore`: a WebSocket client of the runner's loopback server. One text message is
## one UTF-8 JSON value. The token goes only into the hello message and is never logged.

const _JSON := preload("res://core/qa_core/dev/qa_json.gd")

## What `poll` saw.
enum Status { CONNECTING, OPEN, CLOSED, NOT_CONNECTED, TOO_LONG }

const _URL_FORMAT: String = "ws://127.0.0.1:%d"
## Room for a frame message: a base64 PNG of a large window.
const _OUTBOUND_BUFFER_BYTES: int = 16 * 1024 * 1024
## Messages over the limit must still fit the engine buffer, so the length check sees them.
const _INBOUND_MARGIN_BYTES: int = 64 * 1024
const _MAX_QUEUED_PACKETS: int = 4096
const _CLOSE_NORMAL: int = 1000

var _peer: WebSocketPeer = null
var _token: String = ""
var _max_bytes: int = 0
var _opened: bool = false
var _closed: bool = false
## Most bytes the engine holds for sending. A message that does not fit next to the bytes waiting to go out is not
## sent: the engine would refuse it with an engine error.
var outbound_limit: int = _OUTBOUND_BUFFER_BYTES


## Starts the connection to the loopback server on `port`. False when it could not start.
func open(port: int, token: String, max_bytes: int) -> bool:
	var peer: WebSocketPeer = WebSocketPeer.new()
	peer.inbound_buffer_size = max_bytes * 2 + _INBOUND_MARGIN_BYTES
	peer.outbound_buffer_size = _OUTBOUND_BUFFER_BYTES
	peer.max_queued_packets = _MAX_QUEUED_PACKETS
	if peer.connect_to_url(_URL_FORMAT % port) != OK:
		return false
	_peer = peer
	_token = token
	_max_bytes = max_bytes
	return true


func is_open() -> bool:
	return not _closed and _peer != null and _peer.get_ready_state() == WebSocketPeer.STATE_OPEN


## Moves the connection on, sends the hello once it is open, and appends the received text messages to `messages`.
func poll(messages: PackedStringArray) -> Status:
	if _closed or _peer == null:
		return Status.CLOSED
	_peer.poll()
	var state: WebSocketPeer.State = _peer.get_ready_state()
	if state == WebSocketPeer.STATE_CONNECTING:
		return Status.CONNECTING
	if state == WebSocketPeer.STATE_CLOSING or state == WebSocketPeer.STATE_CLOSED:
		return Status.CLOSED if _opened else Status.NOT_CONNECTED
	if not _opened:
		_opened = true
		send(_JSON.object(PackedStringArray([_JSON.pair("token", _JSON.text(_token))])))
	while _peer.get_available_packet_count() > 0:
		var packet: PackedByteArray = _peer.get_packet()
		if packet.size() > _max_bytes:
			return Status.TOO_LONG
		messages.append(packet.get_string_from_utf8())
	return Status.OPEN


func send(text: String) -> bool:
	if not is_open():
		return false
	if text.to_utf8_buffer().size() > outbound_limit - _peer.get_current_outbound_buffered_amount():
		return false
	return _peer.send_text(text) == OK


## Closes the connection. The channel is not used again.
func close() -> void:
	if _closed:
		return
	_closed = true
	if _peer != null:
		_peer.close(_CLOSE_NORMAL, "")
		_peer.poll()
	_peer = null
