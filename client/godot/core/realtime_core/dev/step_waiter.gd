extends RefCounted
## Result of one `request_step` of the lockstep transport.

signal finished

var done: bool = false
var ok: bool = false


func finish(result_ok: bool) -> void:
	if done:
		return
	done = true
	ok = result_ok
	finished.emit()
