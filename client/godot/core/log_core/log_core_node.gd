extends Node
## LogCore core node: checks the write buffer and sender timing every frame, and cleans up like `release` when
## the tree removes it outside `release` (app exit).


func _process(_delta: float) -> void:
	LogCore._on_frame()


func _exit_tree() -> void:
	if LogCore._node == self:
		LogCore._on_node_exit()
