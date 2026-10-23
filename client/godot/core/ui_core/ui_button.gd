class_name UIButton
extends Node
## Component of a button UI element: a child of a `BaseButton`. Core and content code get clicks only through the
## callback of `set_on_click`.

## `InputCore` action that clicks this button in the frame it is pressed. Empty: none.
@export var action: String = ""

var _callback: Callable = Callable()
var _button: BaseButton = null
var _on_pressed_callable: Callable = Callable()
## `action` as a `StringName` while this button is in the action click list.
var _action_name: StringName = &""
## Process frame of the last click this button took. A second click in that frame is dropped.
var _click_frame: int = -1
## An accept input click whose frame is not known yet; it becomes `_click_frame` when the next frame starts.
var _accept_pending: bool = false
## For the pending accept click: whether its input is a binding of `action`, and whether `action` was pressed and
## released this frame before that input.
var _accept_bound: bool = false
var _accept_was_pressed: bool = false
var _accept_was_released: bool = false


func _init() -> void:
	_on_pressed_callable = _on_pressed


func _enter_tree() -> void:
	var parent: BaseButton = get_parent() as BaseButton
	if parent != null and parent.pressed.connect(_on_pressed_callable) == OK:
		_button = parent
	UICore._register_button(self)


func _exit_tree() -> void:
	UICore._unregister_button(self)
	if is_instance_valid(_button) and _button.pressed.is_connected(_on_pressed_callable):
		_button.pressed.disconnect(_on_pressed_callable)
	_button = null


## Sets the click callback, an instance method of the object that holds the button. `Callable()` clears it.
func set_on_click(callback: Callable) -> void:
	_callback = callback


func get_action() -> String:
	return action


func _on_pressed() -> void:
	UICore._on_button_pressed(self)
