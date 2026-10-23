class_name RealtimeTransport
extends RefCounted
## Base of the transports `RealtimeCore.set_transport` takes. A transport carries the matchmaker connection and the
## connections between participants, and moves bytes only. A transport overrides the transport operations and adds
## its transport notifications with `add_notice` inside `poll` only. `RealtimeCore` calls `poll` once a frame and then
## takes the notifications in the order they were added.
##
## The transport operation `disconnect` is `disconnect_all`, since `Object.disconnect` takes the name.

## `lockstep_time` value of a transport without a lockstep match time.
const NO_TIME: int = -1
const _FIRST_CAPACITY: int = 16

## Ring of notification objects. A taken notification stays valid until the next `poll`.
var _ring: Array[RealtimeNotice] = []
var _head: int = 0
var _count: int = 0


func _init() -> void:
	_ring.resize(_FIRST_CAPACITY)
	for i: int in _FIRST_CAPACITY:
		_ring[i] = RealtimeNotice.new()


## Starts matching in the match mode: connects the matchmaker connection when there is none.
func start_matching(_mode_id: int, _access_token: String, _lockstep: bool) -> void:
	pass


func cancel_matching() -> void:
	pass


## Opens a new matchmaker connection and rejoins the match.
func rejoin(_match_id: String, _access_token: String) -> void:
	pass


## Starts the connection with a participant.
func connect_peer(_index: int) -> void:
	pass


## Sends a packet to a participant. The transport does not keep `packet` after it returns.
func send_packet(_index: int, _channel: RealtimeCore.RealtimeChannel, _packet: PackedByteArray) -> bool:
	return false


## Closes the connection with a participant. Its peer connected and peer lost do not come until `close` or
## `disconnect_all`.
func close_peer(_index: int) -> void:
	pass


## Leaves the match and closes every participant connection. Closes the matchmaker connection out of a room.
func close() -> void:
	pass


## The transport operation `disconnect`: closes every connection without leaving the match.
func disconnect_all() -> void:
	pass


## Reads the connections and adds the transport notifications.
func poll() -> void:
	pass


## Opens a room: creates one in `mode_id` when `room_code` is empty, joins the room `room_code` otherwise.
func open_room(_mode_id: int, _room_code: String, _access_token: String, _lockstep: bool) -> void:
	pass


func leave_room() -> void:
	pass


func kick_room_member(_user_id: int) -> void:
	pass


func start_room() -> void:
	pass


## Lockstep match time in ms, or `NO_TIME`.
func lockstep_time() -> int:
	return NO_TIME


## The oldest notification not taken yet, or `null`.
func take_notice() -> RealtimeNotice:
	if _count == 0:
		return null
	var notice: RealtimeNotice = _ring[_head]
	_head = (_head + 1) % _ring.size()
	_count -= 1
	return notice


## Adds a notification of `kind` with default payload and returns it for the transport to fill.
func add_notice(kind: RealtimeNotice.Kind) -> RealtimeNotice:
	if _count == _ring.size():
		_grow()
	var notice: RealtimeNotice = _ring[(_head + _count) % _ring.size()]
	notice.reset(kind)
	_count += 1
	return notice


## Drops the notifications not taken yet.
func clear_notices() -> void:
	_head = 0
	_count = 0


## Number of notifications not taken yet.
func notice_count() -> int:
	return _count


func _grow() -> void:
	var size: int = _ring.size()
	var grown: Array[RealtimeNotice] = []
	grown.resize(size * 2)
	for i: int in size:
		grown[i] = _ring[(_head + i) % size]
	for i: int in range(size, size * 2):
		grown[i] = RealtimeNotice.new()
	_ring = grown
	_head = 0
