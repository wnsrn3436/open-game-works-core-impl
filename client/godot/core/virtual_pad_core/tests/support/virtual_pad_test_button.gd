class_name VirtualPadTestButton
extends Button
## A `SceneUI` button under the virtual pad that counts the touch and mouse input it gets and its clicks.

var inputs: int = 0
var clicks: int = 0


func _ready() -> void:
	pressed.connect(_on_pressed)


func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch or event is InputEventScreenDrag or event is InputEventMouse:
		inputs += 1


func _on_pressed() -> void:
	clicks += 1
