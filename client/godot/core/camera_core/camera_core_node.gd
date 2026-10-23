extends Node
## Core node of `CameraCore`: runs the frame processing of the game camera.

## Runs after the frame processing of `TweenCore` and of content nodes with the default priority, so a follow target
## moved this frame is followed this frame.
const _PROCESS_PRIORITY: int = 200

## Set by `CameraCore` release so that `_exit_tree` does not clean up a second time.
var released: bool = false


func _init() -> void:
	name = "CameraCore"
	# shake runs on real elapsed time, also during the game time pause
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = _PROCESS_PRIORITY


func _process(_delta: float) -> void:
	CameraCore._on_frame()


func _exit_tree() -> void:
	if not released:
		CameraCore._on_node_exit(self)
