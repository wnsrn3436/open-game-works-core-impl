extends RefCounted
## Runs a `ResourceCore` async operation without waiting for it, so a test can look at the state while it runs.

signal finished

var done: bool = false
var resource: Resource = null
var ok: bool = false


## Async. `ResourceCore.load`; the result goes to `resource`.
func run_load(key: String, kind: int, scope: Scope) -> void:
	resource = await ResourceCore.load(key, kind, scope)
	done = true
	finished.emit()


## Async. `ResourceCore.preload_resources`; the result goes to `ok`.
func run_preload(request: PreloadRequest, scope: Scope) -> void:
	ok = await ResourceCore.preload_resources(request, scope)
	done = true
	finished.emit()


## Async. Ends when the operation ended.
func wait() -> void:
	if not done:
		await finished
