extends UnitTestCase
## WebSocket relays on the test host, through the real `WebSocketPeer` (in the browser run, the browser's `WebSocket`).

const _PROTOCOL: String = "ogw-test"


## One relay event of the control.
class RelayEvent extends RefCounted:
	var event: String = ""
	var conn: int = 0
	var path: String = ""
	var protocols: PackedStringArray = PackedStringArray()
	var binary: bool = false
	var data: PackedByteArray = PackedByteArray()
	var code: int = 0
	var reason: String = ""
	var message: String = ""


## Relay events the control received, in order.
var _events: Array[RelayEvent] = []
var _sockets: Array[WebSocketPeer] = []


## The socket waits check once a frame with no frame count and end at the release of EventCore, which the test time
## limit releases.
func before_each() -> void:
	super()
	assert_true(EventCore.init(), "EventCore.init")


func after_each() -> void:
	await super()
	EventCore.release()
	for socket: WebSocketPeer in _sockets:
		socket.close()
	_sockets.clear()
	_events.clear()


func _connect(url: String, protocols: PackedStringArray = PackedStringArray()) -> WebSocketPeer:
	var socket: WebSocketPeer = WebSocketPeer.new()
	socket.supported_protocols = protocols
	assert_eq(socket.connect_to_url(url), OK, "connect_to_url %s" % url)
	_sockets.append(socket)
	return socket


## Polls every socket each frame until `socket` leaves `STATE_CONNECTING`, or EventCore is released, and returns its
## state. Async.
func _wait_connected(socket: WebSocketPeer, control: WebSocketPeer) -> WebSocketPeer.State:
	while socket.get_ready_state() == WebSocketPeer.STATE_CONNECTING and EventCore.is_initialized():
		await _poll(control)
	return socket.get_ready_state()


## Polls every socket each frame until the control received `n` events, or EventCore is released. Async.
func _wait_events(n: int, control: WebSocketPeer) -> void:
	while _events.size() < n and EventCore.is_initialized():
		await _poll(control)


## Polls every socket each frame until `socket` is closed, or EventCore is released. Async.
func _wait_closed(socket: WebSocketPeer, control: WebSocketPeer) -> void:
	while socket.get_ready_state() != WebSocketPeer.STATE_CLOSED and EventCore.is_initialized():
		await _poll(control)


## One frame: polls every socket and reads the events of `control`. Async.
func _poll(control: WebSocketPeer) -> void:
	await get_tree().process_frame
	for socket: WebSocketPeer in _sockets:
		socket.poll()
	while control != null and control.get_available_packet_count() > 0:
		var packet: PackedByteArray = control.get_packet()
		assert_true(control.was_string_packet(), "relay events are text frames")
		_events.append(_event(packet))


# ogw:input_boundary
func _event(bytes: PackedByteArray) -> RelayEvent:
	var read: RelayEvent = RelayEvent.new()
	var parsed: Variant = JSON.parse_string(bytes.get_string_from_utf8())
	if not parsed is Dictionary:
		return read
	var object: Dictionary = parsed
	read.event = str(object.get("event", ""))
	read.conn = _int(object.get("conn", 0.0))
	read.path = str(object.get("path", ""))
	var protocols: Variant = object.get("protocols", [])
	if protocols is Array:
		for protocol: Variant in protocols:
			read.protocols.append(str(protocol))
	read.binary = object.get("binary", false) == true
	read.data = Marshalls.base64_to_raw(str(object.get("data", "")))
	read.code = _int(object.get("code", 0.0))
	read.reason = str(object.get("reason", ""))
	read.message = str(object.get("message", ""))
	return read


# ogw:input_boundary
func _int(value: Variant) -> int:
	if value is float:
		var number: float = value
		return int(number)
	return 0


## Sends a control frame: `op`, the client connection, and the JSON members after them as text.
func _command(control: WebSocketPeer, op: String, conn: int, members: String) -> void:
	assert_eq(control.send_text('{"op": "%s", "conn": %d, %s}' % [op, conn, members]), OK)


func test_a_relay_tells_the_control_of_a_client_and_passes_frames_both_ways() -> void:
	var relay: UnitTestWsRelay = await UnitTestCore.open_ws_relay()
	assert_true(relay.url.begins_with("ws://127.0.0.1:"), "client URL %s" % relay.url)
	assert_true(relay.control_url.begins_with("ws://127.0.0.1:"), "control URL %s" % relay.control_url)
	var client: WebSocketPeer = _connect(relay.url + "/realtime?a=1", PackedStringArray([_PROTOCOL, "other"]))
	assert_eq(await _wait_connected(client, null), WebSocketPeer.STATE_OPEN, "the client connects before the control")
	assert_eq(client.get_selected_protocol(), _PROTOCOL, "the relay takes the first protocol")
	assert_eq(client.send(PackedByteArray([1, 2, 3])), OK)
	assert_eq(client.send_text("text"), OK)
	var control: WebSocketPeer = _connect(relay.control_url)
	assert_eq(await _wait_connected(control, control), WebSocketPeer.STATE_OPEN)
	await _wait_events(3, control)
	assert_eq([_events[0].event, _events[0].conn, _events[0].path, _events[0].protocols],
			["open", 1, "/realtime?a=1", PackedStringArray([_PROTOCOL, "other"])], "the events before the control come when it connects")
	assert_eq([_events[1].event, _events[1].conn, _events[1].binary, _events[1].data], ["message", 1, true, PackedByteArray([1, 2, 3])])
	assert_eq([_events[2].event, _events[2].conn, _events[2].binary, _events[2].data], ["message", 1, false, "text".to_utf8_buffer()])
	_command(control, "send", 1, '"binary": true, "data": "%s"' % Marshalls.raw_to_base64(PackedByteArray([9, 8])))
	while client.get_available_packet_count() == 0 and EventCore.is_initialized():
		await _poll(control)
	assert_eq(client.get_packet(), PackedByteArray([9, 8]))
	assert_false(client.was_string_packet())
	_command(control, "close", 1, '"code": 4001, "reason": "bye"')
	await _wait_closed(client, control)
	assert_eq(client.get_close_code(), 4001)
	assert_eq(client.get_close_reason(), "bye")
	await _wait_events(4, control)
	assert_eq([_events[3].event, _events[3].conn, _events[3].code, _events[3].reason], ["close", 1, 4001, "bye"])


func test_a_control_frame_the_relay_cannot_do_is_an_error_event() -> void:
	var relay: UnitTestWsRelay = await UnitTestCore.open_ws_relay()
	var control: WebSocketPeer = _connect(relay.control_url)
	assert_eq(await _wait_connected(control, control), WebSocketPeer.STATE_OPEN)
	_command(control, "send", 1, '"binary": true, "data": ""')
	await _wait_events(1, control)
	assert_eq(_events[0].event, "error", "no client connection 1")
	assert_false(_events[0].message.is_empty())
	var client: WebSocketPeer = _connect(relay.url)
	await _wait_events(2, control)
	assert_eq([_events[1].event, _events[1].conn, _events[1].path], ["open", 1, ""])
	_command(control, "close", 1, '"code": 1005, "reason": ""')
	await _wait_events(3, control)
	assert_eq(_events[2].event, "error", "1005 cannot be sent in a close frame")
	assert_eq(client.get_ready_state(), WebSocketPeer.STATE_OPEN)


func test_two_relays_have_their_own_urls_and_the_end_of_the_test_closes_their_connections() -> void:
	var first: UnitTestWsRelay = await UnitTestCore.open_ws_relay()
	var second: UnitTestWsRelay = await UnitTestCore.open_ws_relay()
	assert_false(first.url.is_empty() or second.url.is_empty(), "two relays")
	assert_ne(first.url, second.url)
	assert_ne(first.control_url, second.control_url)
	var control: WebSocketPeer = _connect(first.control_url)
	var client: WebSocketPeer = _connect(second.url)
	assert_eq(await _wait_connected(control, control), WebSocketPeer.STATE_OPEN)
	assert_eq(await _wait_connected(client, null), WebSocketPeer.STATE_OPEN)
	await UnitTestCore._delete_test_servers()
	await _wait_closed(control, null)
	await _wait_closed(client, null)
	assert_eq(control.get_close_code(), 1001, "deleting the first relay closes its control")
	assert_eq(client.get_close_code(), 1001, "deleting the second relay closes its client")
