extends RefCounted
## Loopback WebSocket server of the QACore automation channel tests: the runner's side of the channel.

const _BUFFER_BYTES: int = 32 * 1024 * 1024

var port: int = 0
## Text messages received, in order.
var messages: PackedStringArray = PackedStringArray()
var connections: int = 0
var _server: TCPServer = null
var _peer: WebSocketPeer = null


## Listens on a free loopback port. False when it could not.
func start() -> bool:
	_server = TCPServer.new()
	if _server.listen(0, "127.0.0.1") != OK:
		return false
	port = _server.get_local_port()
	return true


## Takes a waiting connection and reads the messages that came.
func poll() -> void:
	if _server != null and _server.is_connection_available():
		var peer: WebSocketPeer = WebSocketPeer.new()
		peer.inbound_buffer_size = _BUFFER_BYTES
		peer.outbound_buffer_size = _BUFFER_BYTES
		if peer.accept_stream(_server.take_connection()) == OK:
			_peer = peer
			connections += 1
	if _peer == null:
		return
	_peer.poll()
	while _peer.get_available_packet_count() > 0:
		messages.append(_peer.get_packet().get_string_from_utf8())


func is_open() -> bool:
	return _peer != null and _peer.get_ready_state() == WebSocketPeer.STATE_OPEN


func is_closed() -> bool:
	return _peer != null and _peer.get_ready_state() == WebSocketPeer.STATE_CLOSED


func send(text: String) -> bool:
	return is_open() and _peer.send_text(text) == OK


## Closes the connection from the server side.
func close() -> void:
	if _peer != null:
		_peer.close(1000, "")
		_peer.poll()


func stop() -> void:
	close()
	_peer = null
	if _server != null:
		_server.stop()
	_server = null
