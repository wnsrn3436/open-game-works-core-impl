class_name UIAnchor
extends Node
## Component that names its parent UI element (`Control`) for `UICore.get_anchor_rect`: what `TutorialCore`
## highlights and what the automation channel presses.

## snake_case anchor name. Inside a `UIScrollList` item UI it is found as `<name>.<index>`.
@export var anchor_name: String = ""

## ID value of what the UI element points to; picks one of the anchors of the same name. 0: none.
var anchor_key: int = 0


func _enter_tree() -> void:
	UICore._register_anchor(self)


func _exit_tree() -> void:
	UICore._unregister_anchor(self)


## Sets the anchor key. 0 clears it. A key below 0 leaves it as it is.
func set_anchor_key(key: int) -> void:
	if key < 0:
		LogCore.log_error(UICore._TAG, "set_anchor_key: anchor key %d is below 1" % key)
		return
	anchor_key = key
