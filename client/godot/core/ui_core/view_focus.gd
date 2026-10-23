extends "res://core/ui_core/focus_holder.gd"
## A view focus of `UICore.set_view_focus`: focus elements of one `FocusView`.

var elements: Array[Control] = []
var initial: Control = null
var accept: Callable = Callable()
