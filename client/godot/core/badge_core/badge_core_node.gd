extends Node
## Core node of `BadgeCore`. Checks the evaluator refresh interval every frame and receives the UserState changes.

## Set by `BadgeCore` release so that `_exit_tree` does not clean up a second time.
var released: bool = false


func _init() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func _process(_delta: float) -> void:
	BadgeCore._on_frame()


func _on_user_state_changed(_event: UserStateChangedEvent) -> void:
	BadgeCore._on_user_state_changed()


func _exit_tree() -> void:
	if not released:
		BadgeCore._on_node_exit()
