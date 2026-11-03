class_name RealtimeAsyncCall
extends RefCounted
## Starts one async operation of `RealtimeCore` and keeps its result, so a test can act while it waits.

signal finished

var done: bool = false
var join_result: MatchJoinResult = null
## Result of the first `join_match` of `join_match_and_retry`.
var first_join_result: MatchJoinResult = null
var room_result: RoomResult = null
var step_result: bool = false


func join_match(mode_id: int) -> void:
	join_result = await RealtimeCore.join_match(mode_id)
	_finish()


## Calls `join_match` again inside the continuation of the first result.
func join_match_and_retry(mode_id: int) -> void:
	first_join_result = await RealtimeCore.join_match(mode_id)
	join_result = await RealtimeCore.join_match(mode_id)
	_finish()


## Calls `create_room` inside the continuation of the `join_match` result.
func join_match_then_create_room(mode_id: int) -> void:
	first_join_result = await RealtimeCore.join_match(mode_id)
	room_result = await RealtimeCore.create_room(mode_id)
	_finish()


## Calls `leave_room` and `join_room` inside the continuation of the `join_match` result.
func join_match_then_join_other_room(mode_id: int, room_code: String) -> void:
	first_join_result = await RealtimeCore.join_match(mode_id)
	RealtimeCore.leave_room()
	room_result = await RealtimeCore.join_room(room_code)
	_finish()


## Calls `leave_room` and `create_room` inside the continuation of the `join_match` result.
func join_match_then_create_other_room(mode_id: int) -> void:
	first_join_result = await RealtimeCore.join_match(mode_id)
	RealtimeCore.leave_room()
	room_result = await RealtimeCore.create_room(mode_id)
	_finish()


## Calls `leave_room` inside the continuation of the `join_match` result.
func join_match_then_leave_room(mode_id: int) -> void:
	join_result = await RealtimeCore.join_match(mode_id)
	RealtimeCore.leave_room()
	_finish()


## Inside the continuation of the `join_match` result, starts a `create_room`, ends its wait with `leave_room` and calls
## `create_room` again.
func join_match_then_recreate_room(mode_id: int) -> void:
	first_join_result = await RealtimeCore.join_match(mode_id)
	var waiting: RealtimeAsyncCall = RealtimeAsyncCall.new()
	waiting.create_room(mode_id)
	RealtimeCore.leave_room()
	room_result = await RealtimeCore.create_room(mode_id)
	_finish()


func rejoin_match(match_id: String) -> void:
	join_result = await RealtimeCore.rejoin_match(match_id)
	_finish()


func start_room() -> void:
	join_result = await RealtimeCore.start_room()
	_finish()


func wait_match() -> void:
	join_result = await RealtimeCore.wait_match()
	_finish()


func create_room(mode_id: int) -> void:
	room_result = await RealtimeCore.create_room(mode_id)
	_finish()


func join_room(room_code: String) -> void:
	room_result = await RealtimeCore.join_room(room_code)
	_finish()


func request_step(ms: int) -> void:
	step_result = await RealtimeCoreDev.request_step(ms)
	_finish()


func lockstep_step(transport: LockstepRealtimeTransport, ms: int) -> void:
	step_result = await transport.request_step(ms)
	_finish()


## Waits until the operation ends.
func wait() -> void:
	if not done:
		await finished


func _finish() -> void:
	done = true
	finished.emit()
