extends RefCounted
## Waits for the layout prefab load of one `open_layout`. `cancel` ends the wait at once; the load result that comes
## later is dropped.

signal done

## Resource scope of the load.
var scope: Scope = null
var finished: bool = false
var cancelled: bool = false
var resource: Resource = null


func start_load(key: String, load_scope: Scope) -> void:
	var loaded: Resource = await ResourceCore.load(key, ResourceCore.BaseKind.PACKED_SCENE, load_scope)
	if cancelled:
		return
	resource = loaded
	finished = true
	done.emit()


func cancel() -> void:
	if finished or cancelled:
		return
	cancelled = true
	done.emit()
