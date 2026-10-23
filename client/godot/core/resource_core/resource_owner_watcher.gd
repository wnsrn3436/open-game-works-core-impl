extends Node
## Internal child of an owner object. It releases the owner scope when the owner object is destroyed.

var scope: Scope = null
var owner_id: int = 0


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		ResourceCore._on_owner_deleted(self)
