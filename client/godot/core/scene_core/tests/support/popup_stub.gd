extends UIPopup
## Root script of the SceneCore test popup: `prepare` waits for `gate` when it is set.

const Gate := preload("res://core/scene_core/tests/support/gate.gd")

static var gate: Gate = null


func prepare() -> bool:
	if gate != null:
		var ok: bool = await gate.wait()
		return ok
	return true
