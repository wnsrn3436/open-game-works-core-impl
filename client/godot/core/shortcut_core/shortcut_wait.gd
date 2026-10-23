extends RefCounted
## Waits for one async operation of a `ShortcutCore` navigation. `cancel` ends the wait at once; the result that comes
## later is dropped.

signal done

var finished: bool = false
var cancelled: bool = false
## Success flag of the operation.
var ok: bool = false


## Calls `operation` and waits for it. The result is a success flag only when it returned `true`.
# ogw:input_boundary
func start(operation: Callable) -> void:
	var value: Variant = await operation.call()
	if cancelled:
		return
	ok = value is bool and value == true
	finished = true
	done.emit()


func cancel() -> void:
	if finished or cancelled:
		return
	cancelled = true
	done.emit()
