extends RefCounted
## Waits for one async call of `UICore`: a resource load, a `prepare`, a tween end or a popup close. `cancel` ends the
## wait at once; the result that comes later is dropped.

signal done

var finished: bool = false
var cancelled: bool = false
## Success flag of a `prepare`.
var ok: bool = false
## Resource of a load.
var resource: Resource = null


## Calls `callable` and waits for it. The result is a success flag only when it returned `true`.
# ogw:input_boundary
func start_bool(callable: Callable) -> void:
	var value: Variant = await callable.call()
	if cancelled:
		return
	ok = value is bool and value == true
	_finish()


func start_load(key: String, kind: int, scope: Scope) -> void:
	var loaded: Resource = await ResourceCore.load(key, kind, scope)
	if cancelled:
		return
	resource = loaded
	_finish()


func start_tween(handle: int) -> void:
	await TweenCore.wait_end(handle)
	if cancelled:
		return
	_finish()


## Ends the wait now. Used as a callback too: a popup's hidden callback.
func fire() -> void:
	if finished or cancelled:
		return
	_finish()


func cancel() -> void:
	if finished or cancelled:
		return
	cancelled = true
	done.emit()


func _finish() -> void:
	finished = true
	done.emit()
