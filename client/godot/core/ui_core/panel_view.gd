extends "res://core/ui_core/focus_holder.gd"
## One panel instance `UICore` made: the current panel, or one being prepared by a panel transition.

const _ENTRY := preload("res://core/ui_core/panel_entry.gd")

## The stack item it shows. `null` while it is prepared.
var entry: _ENTRY = null
var panel: UIPanel = null
var scope: Scope = null
## `UIOpenedEvent` was published for it.
var opened_event: bool = false
## `on_closed` was called.
var closed_called: bool = false
