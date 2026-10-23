class_name VirtualPadJoystick
extends Control
## Virtual joystick element of a virtual pad layout prefab. `VirtualPadCore` turns its pointer into the direction value
## and injects the strengths of the four direction actions, and moves the centers of `base` and `handle`.

## Direction actions: actions of the action list.
@export var action_negative_x: StringName = &""
@export var action_positive_x: StringName = &""
@export var action_negative_y: StringName = &""
@export var action_positive_y: StringName = &""
## Default base center: a point of the element area, in its local coordinates.
@export var base_position: Vector2 = Vector2.ZERO
## Base radius in game coordinates, above 0.
@export var base_radius: float = 0.0
## Base picture and handle picture: nodes below this element.
@export var base: Control = null
@export var handle: Control = null


func _gui_input(event: InputEvent) -> void:
	VirtualPadCore._on_element_input(self, event)
