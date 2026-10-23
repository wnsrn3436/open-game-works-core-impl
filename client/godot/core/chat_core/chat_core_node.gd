extends Node
## Core node of ChatCore: the frame check of its polling timers and the background return event.

## Set by `ChatCore.release` before it takes the node off the tree.
var released: bool = false


func _process(_delta: float) -> void:
	ChatCore._on_frame()


func _exit_tree() -> void:
	if not released:
		ChatCore._on_node_exit(self)


func on_foreground_returned(_event: AppForegroundReturnedEvent) -> void:
	ChatCore._on_foreground_returned()
