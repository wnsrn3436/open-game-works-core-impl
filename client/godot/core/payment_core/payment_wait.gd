extends RefCounted
## One awaited step of a PaymentCore async operation: a store adapter call or a running `prepare`,
## `recover_purchases` or `restore_purchases` that later callers share. `finish` resumes the waiting side once;
## `release` and the store call time limit finish it with a failure.

signal done

## True after `finish`.
var finished: bool = false
## Success flag the finishing side left.
var ok: bool = false
## Result object the finishing side left. `null` when there is none or the wait was cut short.
var value: RefCounted = null
## Real elapsed time (`TimeCore.get_real_time`) the store call fails at. -1: no time limit.
var deadline: int = -1


## Leaves the result and resumes the waiting side. Later calls do nothing.
func finish(success: bool, result: RefCounted = null) -> void:
	if finished:
		return
	finished = true
	ok = success
	value = result
	done.emit()
