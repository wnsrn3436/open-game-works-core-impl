extends Node
## Core node of `EventCore`. A tree teardown without `release` clears the module state the way `release` does.


func _exit_tree() -> void:
	EventCore._on_node_exit_tree(self)
