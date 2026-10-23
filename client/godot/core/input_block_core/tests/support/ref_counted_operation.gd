extends RefCounted
## An async operation for `run_blocked` on a `RefCounted` object, whose instance ID is negative. Waits until the test
## calls `finish`.

signal finished(ok: bool)

var calls: int = 0


func operation() -> bool:
	calls += 1
	var ok: bool = await finished
	return ok


func finish(ok: bool) -> void:
	finished.emit(ok)


## A static operation that ends without waiting. Its `Callable` belongs to the script, a `RefCounted` object.
static func immediate() -> bool:
	return true
