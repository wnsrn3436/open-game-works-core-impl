class_name BadgeView
extends Node
## Component that shows a badge on the UI element it is attached to. A child node of that `Control`. `bind` connects
## it to a data badge or one of its item badges; the display follows the count until `unbind`.

## The connection. `_bound` is false when there is none; `_item_key` 0 is the badge itself.
var _bound: bool = false
var _badge_id: int = 0
var _item_key: int = 0
## Display object made by BadgeCore: a holder at the top right corner of the UI element with the dot and the count
## text. An internal child of the UI element. `null` until the first count above 0.
var _display: Control = null
## Count text over the dot. A child of the dot.
var _label: Label = null


## Shows badge `badge_id`, or its item badge `item_key` when that is not 0, on the UI element. A connection made
## before is replaced. On failure the connection does not change.
func bind(badge_id: int, item_key: int = 0) -> bool:
	return BadgeCore._bind_view(self, badge_id, item_key)


## Hides the display and stops following the count. Nothing happens without a connection.
func unbind() -> void:
	BadgeCore._unbind_view(self)


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		BadgeCore._on_view_destroyed(self)
