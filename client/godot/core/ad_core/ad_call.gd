extends RefCounted
## One wait of AdCore on an adapter operation, a request or `AuthCore`. `done` comes when the operation ends, or when
## `AdCore.release` stops the wait.

signal done

var finished: bool = false
## `release` stopped the wait before the operation ended.
var aborted: bool = false
## Result of an operation that returned a `bool`.
var flag: bool = false
## Result of an operation that returned an `int`; -1 when it returned no `int`.
var number: int = -1
## Result of an operation that returned an object.
var value: RefCounted = null


## Ends the wait with the result of the operation. Does nothing after `abort`.
# ogw:input_boundary
func finish(result: Variant) -> void:
	if finished:
		return
	finished = true
	if result is bool:
		flag = result
	elif result is int:
		number = result
	elif result is RefCounted:
		value = result
	done.emit()


## Ends the wait without a result.
func abort() -> void:
	if finished:
		return
	finished = true
	aborted = true
	done.emit()
