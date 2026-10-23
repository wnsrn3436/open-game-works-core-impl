extends Node
## Core node of AuthCore: the frame refresh of the access token and the event subscriptions. It runs during a pause
## and in step mode, since the frame refresh is checked on every frame.


func _init() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func _process(_delta: float) -> void:
	AuthCore._on_frame()


func _on_app_foreground_returned(_event: AppForegroundReturnedEvent) -> void:
	AuthCore._on_foreground_returned()


func _on_app_background_entered(_event: AppBackgroundEnteredEvent) -> void:
	AuthCore._write_pending_token()


func _on_app_quit(_event: AppQuitEvent) -> void:
	AuthCore._write_pending_token()


func _exit_tree() -> void:
	AuthCore._on_node_exit(self)
