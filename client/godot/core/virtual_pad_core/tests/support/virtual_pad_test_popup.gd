class_name VirtualPadTestPopup
extends UIPopup
## A test popup that consumes the pointer input on it and counts the touch and mouse input it gets.

var inputs: int = 0


func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch or event is InputEventScreenDrag or event is InputEventMouse:
		inputs += 1
