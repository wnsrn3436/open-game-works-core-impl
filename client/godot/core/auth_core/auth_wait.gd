extends RefCounted
## One awaited step of an AuthCore async operation. `finish` resumes the waiting operation once; `release` finishes
## every tracked wait so that the operations stop with their failure value.

signal done

## True after `finish`.
var finished: bool = false
## Result the finishing side left. `null` when the wait was cut short.
var result: RefCounted = null


## Leaves `value` and resumes the waiting side. Later calls do nothing.
func finish(value: RefCounted = null) -> void:
	if finished:
		return
	finished = true
	result = value
	done.emit()
