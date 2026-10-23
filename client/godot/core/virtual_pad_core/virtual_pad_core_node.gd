extends Node
## Core node of `VirtualPadCore`: receives frames, `InputDeviceChangedEvent` and `SafeAreaChangedEvent`, and hands them
## to `VirtualPadCore`.


func _process(_delta: float) -> void:
	VirtualPadCore._on_frame()


func _exit_tree() -> void:
	VirtualPadCore._on_node_exit_tree(self)


func _on_device_changed(_event: InputDeviceChangedEvent) -> void:
	VirtualPadCore._on_device_changed()


func _on_safe_area_changed(_event: SafeAreaChangedEvent) -> void:
	VirtualPadCore._on_safe_area_changed()
