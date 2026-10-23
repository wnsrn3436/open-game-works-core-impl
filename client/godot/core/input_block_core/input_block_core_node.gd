extends Node
## Core node of `InputBlockCore`: runs the frame check of the active blocks.


func _process(_delta: float) -> void:
	InputBlockCore._check_blocks()


func _exit_tree() -> void:
	InputBlockCore._on_node_exit(self)
