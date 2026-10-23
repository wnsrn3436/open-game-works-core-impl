extends RefCounted
## A wait of a ChatCore async operation for a request result. `release` fires every wait with a failure.

signal done

var fired: bool = false
var ok: bool = false
## Result of a `send_message` wait.
var result: ChatSendResult = null


func fire(success: bool) -> void:
	if fired:
		return
	fired = true
	ok = success
	done.emit()
