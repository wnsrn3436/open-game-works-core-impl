extends Node
## Core node of `LocalizationCore`: the `EventCore` subscription and the `SceneTree` signals of the text scale.


func _on_input_prompt_changed(_event: InputPromptChangedEvent) -> void:
	LocalizationCore._on_input_prompt_changed()


func _on_node_added(node: Node) -> void:
	LocalizationCore._on_node_added(node)


func _on_node_removed(node: Node) -> void:
	LocalizationCore._on_node_removed(node)


func _exit_tree() -> void:
	LocalizationCore._on_core_node_exit(self)
