extends Node
## Core node of `SafeAreaCore`: receives `GameAreaChangedEvent` and runs the frame check on `android` and `ios`.


func _process(_delta: float) -> void:
	SafeAreaCore._on_frame()


func _on_game_area_changed(_event: GameAreaChangedEvent) -> void:
	SafeAreaCore._on_game_area_changed()


func _exit_tree() -> void:
	SafeAreaCore._on_node_exit(self)
