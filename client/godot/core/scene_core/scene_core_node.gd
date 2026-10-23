extends Node
## Core node of `SceneCore`: runs the frame check of the transition, hides the nodes that enter the scene holder
## while the new scene is not shown yet and keeps the scene UI root of that scene on the safe area.


func _process(_delta: float) -> void:
	SceneCore._check_frame()


func _exit_tree() -> void:
	SceneCore._on_node_exit(self)


func on_node_added(node: Node) -> void:
	SceneCore._on_node_added(node)


func _on_safe_area_changed(_event: SafeAreaChangedEvent) -> void:
	SceneCore._fit_new_ui_root()
