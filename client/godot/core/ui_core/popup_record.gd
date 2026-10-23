extends "res://core/ui_core/focus_holder.gd"
## One `open_popup` or `open_system_popup` call, from the queue to the destruction of its instance.

signal resolved

const _WAITER := preload("res://core/ui_core/call_waiter.gd")

enum State { QUEUED, PREPARING, OPENING, OPEN, CLOSING, DONE }

var state: State = State.QUEUED
var key: String = ""
var param: UIParam = null
var suppress: PopupSuppress = null
var hidden_callback: Callable = Callable()
var is_system: bool = false
var system_param: SystemPopupParam = null
## The code made content of a system popup: body, extra text and buttons.
var system_view: Control = null
var scope: Scope = null
var modal: bool = true
var dim: bool = false
var back_policy: UICore.BackPolicy = UICore.BackPolicy.CLOSE
var open_tween: String = ""
var close_tween: String = ""
var initial_focus: Control = null
var tween_handle: int = 0
var open_block: int = 0
var close_block: int = 0
## The open flow ended: `UIOpenedEvent` and the result went out.
var open_finished: bool = false
var opened_event: bool = false
var closed_called: bool = false
## The wait the record is in, ended when the flow is cancelled.
var waiter: _WAITER = null
var result: UICore.PopupOpenResult = UICore.PopupOpenResult.FAILED
var is_resolved: bool = false


func resolve(value: UICore.PopupOpenResult) -> void:
	if is_resolved:
		return
	is_resolved = true
	result = value
	resolved.emit()
