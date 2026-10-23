extends Node
## Core node of RemoteConfigCore: the login and background return subscriptions.


func _on_login_completed(_event: LoginCompletedEvent) -> void:
	RemoteConfigCore._on_login_completed()


func _on_app_foreground_returned(event: AppForegroundReturnedEvent) -> void:
	RemoteConfigCore._on_foreground_returned(event.background_ms)


func _exit_tree() -> void:
	RemoteConfigCore._on_node_exit(self)
