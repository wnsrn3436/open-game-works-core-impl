class_name VirtualPadTestControl
extends Control
## A UI element under the virtual pad that consumes the pointer input on it and counts the touch input it gets.

var touches: int = 0


func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch or event is InputEventScreenDrag:
		touches += 1
