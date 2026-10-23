extends Node
## Core node of `TweenCore`: runs the frame processing of the tweens.


func _process(_delta: float) -> void:
	TweenCore._on_frame()


func _exit_tree() -> void:
	TweenCore._on_node_exit(self)
