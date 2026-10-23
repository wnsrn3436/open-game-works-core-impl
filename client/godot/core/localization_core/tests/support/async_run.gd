extends RefCounted
## An async operation a core test starts without waiting for it, and waits for later.

signal done

var finished: bool = false
var ok: bool = false


## Starts `job`, a coroutine that gets this run and calls `finish` with the success flag of the operation.
func start(job: Callable) -> void:
	job.call(self)


func finish(result: bool) -> void:
	ok = result
	finished = true
	done.emit()


func wait() -> void:
	if not finished:
		await done
