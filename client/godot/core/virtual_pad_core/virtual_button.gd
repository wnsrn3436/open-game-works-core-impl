class_name VirtualButton
extends Control
## Virtual button element of a virtual pad layout prefab. While it has a pointer, `VirtualPadCore` injects the press of
## `action` with strength 1.

## The action this button presses: an action of the action list.
@export var action: StringName = &""


func _gui_input(event: InputEvent) -> void:
	VirtualPadCore._on_element_input(self, event)
