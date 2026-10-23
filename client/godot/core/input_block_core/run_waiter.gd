extends RefCounted
## Runs the async operation of one `run_blocked` call. `run_blocked` waits for `done`, which the waiter emits when the
## operation ends and `InputBlockCore` emits when it stops waiting (owner object destroyed, `release`).

signal done

## The operation ended.
var finished: bool = false
## The success flag of the operation. Valid when `finished`.
var result: bool = false
## `run_blocked` stopped waiting: the owner object was destroyed, while the block was active or after it was lifted.
var aborted: bool = false
## Instance ID of the owner object of the block. 0: no owner object.
var owner_id: int = 0
## Index in the running waiters of `InputBlockCore` while the `run_blocked` call has not returned, or -1.
var index: int = -1


## Calls the operation and waits for it. The result is a success flag only when the operation returned `true`.
# ogw:input_boundary
func start(operation: Callable) -> void:
	var value: Variant = await operation.call()
	finished = true
	result = value is bool and value == true
	done.emit()
