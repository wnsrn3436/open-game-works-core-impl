extends Node
## Core node of `UICore`: the parent of the UI layers. It watches input for the focus mode, keeps the focus, the
## keyboard shift and the action clicks every frame, and turns the code made loading icon.

## Set by `UICore` release so that `_exit_tree` does not clean up a second time.
var released: bool = false


## Its process callback comes before the content code of every frame, as the `InputCore` core node does.
class _FrameStart:
	extends Node

	func _init() -> void:
		process_mode = Node.PROCESS_MODE_ALWAYS
		process_priority = -100000

	func _process(_delta: float) -> void:
		UICore._on_frame_start()


func _init() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(_FrameStart.new(), false, Node.INTERNAL_MODE_FRONT)


func _input(event: InputEvent) -> void:
	UICore._on_input(event)


func _unhandled_input(event: InputEvent) -> void:
	UICore._on_unhandled_input(event)


func _process(delta: float) -> void:
	UICore._on_frame(delta)


func _exit_tree() -> void:
	if not released:
		UICore._on_node_exit()


func _on_focus_changed(control: Control) -> void:
	UICore._on_focus_changed(control)


func _on_device_changed(event: InputDeviceChangedEvent) -> void:
	UICore._on_device_changed(event.device)


func _on_gamepad_connection_changed(event: GamepadConnectionChangedEvent) -> void:
	UICore._on_gamepad_connection_changed(event.gamepad_id, event.connected)


func _on_safe_area_changed(_event: SafeAreaChangedEvent) -> void:
	UICore._update_keyboard_shift()


func _on_keyboard_area_changed(_event: KeyboardAreaChangedEvent) -> void:
	UICore._update_keyboard_shift()
