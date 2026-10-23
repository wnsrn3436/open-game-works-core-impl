extends RefCounted
## A point where a test scene callback waits until the test opens it. The gate stays open: a callback that reaches it
## after `open`, as when the test opened it right after the callback added its trace entry, goes on at once.

signal opened(ok: bool)

var is_open: bool = false
## The result `open` gave. Valid when `is_open`.
var result: bool = true


func open(ok: bool = true) -> void:
	is_open = true
	result = ok
	opened.emit(ok)


## Async. Waits until the gate is open and returns the result `open` gave.
func wait() -> bool:
	if is_open:
		return result
	var ok: bool = await opened
	return ok
