extends Node
## Core node of `LocalDataCore`: the frame check of the write wait, the deferred write and the
## `AppBackgroundEnteredEvent` subscription.


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func _process(_delta: float) -> void:
	LocalDataCore._on_frame()


func _exit_tree() -> void:
	LocalDataCore._on_node_exit(self)


func _on_deferred_write() -> void:
	LocalDataCore._on_write_due()


func _on_app_background_entered(_event: AppBackgroundEnteredEvent) -> void:
	LocalDataCore._on_app_background_entered()
