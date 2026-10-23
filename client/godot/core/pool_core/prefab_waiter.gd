extends RefCounted
## One prefab load `PoolCore.prefill` waits for. `PoolCore.release` ends the wait early with `aborted`.

signal done

var resource: Resource = null
var finished: bool = false
var aborted: bool = false


## Loads the prefab. Ends the wait when the load ends unless `abort` ended it first.
func start(resource_key: String, kind: int, scope: Scope) -> void:
	var loaded: Resource = await ResourceCore.load(resource_key, kind, scope)
	if finished:
		return
	resource = loaded
	finished = true
	done.emit()


func abort() -> void:
	if finished:
		return
	aborted = true
	finished = true
	done.emit()
