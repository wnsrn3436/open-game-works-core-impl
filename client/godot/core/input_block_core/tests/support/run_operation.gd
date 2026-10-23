extends Node
## An async operation for `run_blocked` that waits until the test calls `finish`.

signal finished(ok: bool)

var calls: int = 0


func operation() -> bool:
	calls += 1
	var ok: bool = await finished
	return ok


func finish(ok: bool) -> void:
	finished.emit(ok)


## Cancels the operation: it ends with its failure value.
func cancel() -> void:
	finished.emit(false)


## An operation that calls `InputBlockCore.release` before it waits until the test calls `finish`.
func release_then_wait() -> bool:
	calls += 1
	InputBlockCore.release()
	var ok: bool = await finished
	return ok


## An operation that calls `InputBlockCore.release` and ends without waiting.
func release_then_succeed() -> bool:
	calls += 1
	InputBlockCore.release()
	return true


## An operation that ends without waiting.
func immediate() -> bool:
	calls += 1
	return true
