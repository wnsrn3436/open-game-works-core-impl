extends RefCounted
## Result of one `create_room` or `join_room`.

signal finished

var done: bool = false
var ok: bool = false
var error_code: int = 0


## Sets the result once and wakes the waiting operation.
func finish(result_ok: bool, code: int) -> void:
	if done:
		return
	done = true
	ok = result_ok
	error_code = code
	finished.emit()


## A new result with the values of this operation.
func to_result() -> RoomResult:
	var result: RoomResult = RoomResult.new()
	result.ok = ok
	result.error_code = error_code
	return result
