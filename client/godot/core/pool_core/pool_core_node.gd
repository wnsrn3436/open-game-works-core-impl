extends Node
## Core node of `PoolCore`: receives the memory warning. A tree teardown without `release` clears the module state the
## way `release` does.


func _notification(what: int) -> void:
	if what == NOTIFICATION_OS_MEMORY_WARNING:
		PoolCore._on_memory_warning()


func _exit_tree() -> void:
	PoolCore._on_node_exit_tree(self)
