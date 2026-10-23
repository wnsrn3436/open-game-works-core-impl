class_name ContractKind
extends RefCounted
## One UserState kind of the generated `user_state_kinds()` list.

## Kind message name. Example: `QuestUserState`.
var name: String = ""
## The generated kind class.
var kind_class: GDScript = null
## True for a list kind: a kind with field `int64 id = 1`.
var is_list: bool = false


func _init(kind_name: String = "", kind_script: GDScript = null, list: bool = false) -> void:
	name = kind_name
	kind_class = kind_script
	is_list = list
