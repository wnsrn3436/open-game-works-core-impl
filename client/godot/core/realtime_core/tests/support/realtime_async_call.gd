class_name RealtimeAsyncCall
extends RefCounted
## Starts one async operation of `RealtimeCore` and keeps its result, so a test can act while it waits.

signal finished

var done: bool = false
var join_result: MatchJoinResult = null
var room_result: RoomResult = null
var step_result: bool = false


func join_match(mode_id: int) -> void:
	join_result = await RealtimeCore.join_match(mode_id)
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
