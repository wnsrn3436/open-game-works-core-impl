extends Node
## Core node of `MessageCore`. Moves the messages on screen through their display steps every frame.

## Runs after the frame processing of the modules MessageCore reads, so a tween end and a time step of this frame are
## seen in this frame.
const _PROCESS_PRIORITY: int = 100

## Set by `MessageCore` release so that `_exit_tree` does not clean up a second time.
var released: bool = false


func _init() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = _PROCESS_PRIORITY


func _process(_delta: float) -> void:
	MessageCore._on_frame()


func _exit_tree() -> void:
	if not released:
		MessageCore._on_node_exit()
