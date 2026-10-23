extends Node
## Core node of `ResourceCore`: the frame check of the leak check and the parent of the shader warmup holder.


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func _process(_delta: float) -> void:
	ResourceCore._on_frame()


func _exit_tree() -> void:
	ResourceCore._on_node_exit(self)


func _on_leak_check() -> void:
	ResourceCore._check_leaks()
