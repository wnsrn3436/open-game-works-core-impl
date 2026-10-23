extends RefCounted
## An AuthCore async operation a core test starts and awaits later.

signal done

var finished: bool = false
var result: RefCounted = null
var flag: bool = false
var status: int = -1


## Starts `job`, a coroutine that gets this flow and calls `finish`.
func start(job: Callable) -> void:
	job.call(self)


func finish() -> void:
	finished = true
	done.emit()


func wait() -> void:
	if not finished:
		await done
