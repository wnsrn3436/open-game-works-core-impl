extends PoolObject
## Root script of the SceneCore test pool prefab. Records its creation in the scene trace.

const Trace := preload("res://core/scene_core/tests/support/scene_trace.gd")
const PRELOAD_ITEM: String = "prefab/scene_core_test_preload_item"

## The preload item of the test scene was loaded when an instance was made.
static var preload_was_loaded: bool = false


func _init() -> void:
	if ResourceCore.is_loaded(PRELOAD_ITEM, ResourceCore.BaseKind.PACKED_SCENE):
		preload_was_loaded = true
	Trace.add("pool_item")


func on_borrow() -> void:
	pass


func on_return() -> void:
	pass
