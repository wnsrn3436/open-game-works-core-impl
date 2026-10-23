extends RefCounted
## One panel transition. `InputBlockCore.run_blocked` runs `run` under the `ui` block; `cancel` ends it at once.

const _WAITER := preload("res://core/ui_core/call_waiter.gd")
const _VIEW := preload("res://core/ui_core/panel_view.gd")

enum Kind { OPEN, CLOSE }

var kind: Kind = Kind.OPEN
## Opened panel key, or the panel key a close flow closes down to. The payload of `PanelFlowFinishedEvent`.
var panel_key: String = ""
var param: UIParam = null
var clear_stack: bool = false
var force: bool = false
## Put by `open_root_panel`.
var root: bool = false
## Items of `open_panels` before the last one.
var before: Array[UIPanelRequest] = []
## Stack index of the first destination of a close flow.
var destination: int = -1
var cancelled: bool = false
## The wait the flow is in, ended by `cancel`.
var waiter: _WAITER = null
## The panel the flow showed and its open reason; `UIOpenedEvent` goes out for it when the transition ends.
var shown: _VIEW = null
var shown_reason: UICore.PanelOpenReason = UICore.PanelOpenReason.NEW
## The panel instance being prepared, destroyed on cancel.
var preparing: _VIEW = null


func run() -> bool:
	return await UICore._run_flow(self)


func cancel() -> void:
	if cancelled:
		return
	cancelled = true
	if waiter != null:
		waiter.cancel()
