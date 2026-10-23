extends Node
## Core node of PaymentCore: the frame check of the store call time limits and the delivery retries, and the event
## subscriptions.


func _process(_delta: float) -> void:
	PaymentCore._on_frame()


func _on_app_foreground_returned(_event: AppForegroundReturnedEvent) -> void:
	PaymentCore._on_foreground_returned()


func _on_login_completed(_event: LoginCompletedEvent) -> void:
	PaymentCore._on_login_session_changed()


func _on_session_ended(_event: SessionEndedEvent) -> void:
	PaymentCore._on_login_session_changed()


func _exit_tree() -> void:
	PaymentCore._on_node_exit(self)
