extends RefCounted
## One `get_device_token` call of the push adapter. The adapter's answer or the `PushCore.deviceTokenTimeoutMs` time
## limit finishes it, whichever comes first; `release` finishes it with no token.

signal done

## True after `finish`.
var finished: bool = false
## Device token the finishing side left. Empty when there is none.
var token: String = ""
## `TimeCore` real elapsed time at which the wait ends with no token.
var deadline: int = 0


## Leaves `value` and resumes the waiting side. Later calls do nothing.
func finish(value: String) -> void:
	if finished:
		return
	finished = true
	token = value
	done.emit()
