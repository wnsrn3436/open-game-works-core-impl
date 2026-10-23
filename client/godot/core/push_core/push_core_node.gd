extends Node
## Core node of PushCore: the frame check of the device token time limit and the push adapter notifications, and the
## event subscriptions.


func _process(_delta: float) -> void:
	PushCore._on_frame()


func _on_app_foreground_returned(_event: AppForegroundReturnedEvent) -> void:
	PushCore._read_permission()


func _on_login_completed(_event: LoginCompletedEvent) -> void:
	PushCore._register_token()


func _on_session_ended(event: SessionEndedEvent) -> void:
	PushCore._on_session_ended(event.reason)


func _exit_tree() -> void:
	PushCore._on_node_exit(self)
