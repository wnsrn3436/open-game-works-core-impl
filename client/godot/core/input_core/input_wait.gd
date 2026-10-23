extends RefCounted
## One waiting `InputCore.wait_key` or `wait_pad_button`. The wait ends once, with a name or an empty string (none).

signal done

## The name the wait ended with. Empty for key none and button none.
var value: String = ""
var _finished: bool = false


## Ends the wait with `result` and resumes the waiting operation. Later calls do nothing.
func finish(result: String) -> void:
	if _finished:
		return
	_finished = true
	value = result
	done.emit()
