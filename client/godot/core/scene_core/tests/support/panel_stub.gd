extends UIPanel
## Root script of the SceneCore test panels. Records `on_opened` as `panel:<name>` and fails `prepare` when `fail`.

const Trace := preload("res://core/scene_core/tests/support/scene_trace.gd")
const Gate := preload("res://core/scene_core/tests/support/gate.gd")

## When set, `prepare` waits for it after its trace entry.
static var prepare_gate: Gate = null

@export var fail: bool = false


func prepare(_reason: UICore.PanelOpenReason, _cache: UIPanelCache) -> bool:
	Trace.add("panel_prepare:" + name)
	if prepare_gate != null:
		await prepare_gate.wait()
	return not fail


func on_opened(_reason: UICore.PanelOpenReason) -> void:
	Trace.add("panel:" + name)
