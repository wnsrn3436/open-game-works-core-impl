class_name SafeAreaRoot
extends Control
## Safe area root: a UI element whose position and size `SafeAreaCore` keeps equal to the safe area. It takes no input.
## The UI elements of a UI layer that has one go under it.


func _enter_tree() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	focus_mode = Control.FOCUS_NONE
	SafeAreaCore._register_root(self)


func _exit_tree() -> void:
	SafeAreaCore._unregister_root(self)
