extends Node
## Core node of `InputCore`: receives device input, frames, the scene tree's physics and process frames, app focus
## loss, the platform back button, gamepad connection changes and `AppBackgroundEnteredEvent`, and hands them to
## `InputCore`.


func _input(event: InputEvent) -> void:
	InputCore._on_input(event)


func _unhandled_input(event: InputEvent) -> void:
	InputCore._on_unhandled_input(event)


func _process(_delta: float) -> void:
	InputCore._on_frame()


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		InputCore._on_focus_lost()
	elif what == NOTIFICATION_WM_GO_BACK_REQUEST:
		InputCore._on_platform_back()


func _exit_tree() -> void:
	InputCore._on_node_exit_tree(self)


func _on_tree_frame() -> void:
	InputCore._on_tree_frame()


func _on_joy_connection_changed(device: int, connected: bool) -> void:
	InputCore._on_gamepad_connection(device, connected)


func _on_app_background_entered(_event: AppBackgroundEnteredEvent) -> void:
	InputCore._on_focus_lost()
