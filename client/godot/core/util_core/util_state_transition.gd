class_name UtilStateTransition
extends RefCounted
## One allowed transition of a `UtilStateMachine`: from `from_state` to `to_state`.

var from_state: int = 0
var to_state: int = 0


func _init(from: int = 0, to: int = 0) -> void:
	from_state = from
	to_state = to
