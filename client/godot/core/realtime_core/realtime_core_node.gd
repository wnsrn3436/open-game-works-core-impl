extends Node
## Core node of `RealtimeCore`: polls the transport every frame, also while paused, and receives the background
## return of `TimeCore`. A tree teardown without `release` clears the module the way `release` does.


func _process(_delta: float) -> void:
	RealtimeCore._frame()


func _on_foreground_returned(event: AppForegroundReturnedEvent) -> void:
	RealtimeCore._on_foreground_returned(event.background_ms)


func _exit_tree() -> void:
	RealtimeCore._on_node_exit_tree(self)
