extends Node
## Core node of `QualityCore`: the frame measurement of the auto downgrade, the background entry and return events,
## and the `Light3D` nodes the tree adds and removes while the shadow is `Off`.


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func _process(_delta: float) -> void:
	QualityCore._on_frame()


func _exit_tree() -> void:
	QualityCore._on_node_exit(self)


func _on_node_added(node: Node) -> void:
	QualityCore._on_node_added(node)


func _on_node_removed(node: Node) -> void:
	QualityCore._on_node_removed(node)


func _on_app_background_entered(_event: AppBackgroundEnteredEvent) -> void:
	QualityCore._on_app_background_entered()


func _on_app_foreground_returned(_event: AppForegroundReturnedEvent) -> void:
	QualityCore._on_app_foreground_returned()
