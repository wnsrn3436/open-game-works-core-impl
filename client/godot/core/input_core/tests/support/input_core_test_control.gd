class_name InputCoreTestControl
extends Control
## A UI element that consumes the pointer input on it and counts the GUI input it gets.

## When true, it consumes the key input it gets while it has the focus.
var consume_keys: bool = false
## When not empty, it injects this action with the touch index as pointer ID for each touch press and release it gets.
var pointer_action: StringName = &""
var gui_inputs: int = 0
var touch_presses: int = 0
var touch_moves: int = 0
var touch_releases: int = 0
var mouse_motions: int = 0
var keys: int = 0


func _gui_input(event: InputEvent) -> void:
	gui_inputs += 1
	if event is InputEventKey:
		keys += 1
		if consume_keys:
			accept_event()
	elif event is InputEventMouseMotion:
		mouse_motions += 1
	elif event is InputEventScreenTouch:
		var touch: InputEventScreenTouch = event as InputEventScreenTouch
		if touch.pressed:
			touch_presses += 1
		else:
			touch_releases += 1
		if not pointer_action.is_empty():
			InputCore.inject_action(pointer_action, touch.pressed, 1.0 if touch.pressed else 0.0, touch.index)
	elif event is InputEventScreenDrag:
		touch_moves += 1
