class_name UIPanel
extends Control
## Base of the panel prefab root script. A panel is the screen unit UI `UICore` opens on the `Panel` layer, one
## visible at a time. Only `UICore` calls the panel interface methods; override them in the panel class.

## Back policy of back input that reaches this panel.
@export var back_policy: UICore.BackPolicy = UICore.BackPolicy.CLOSE
## While shown, the UI and world below take no pointer input.
@export var modal: bool = true
## While shown, a dim lies right below.
@export var dim: bool = false
## Tween preset key played on this root when shown by a forward transition. Empty: none.
@export var open_tween: String = ""
## Tween preset key played on this root before it is destroyed by a close flow. Empty: none.
@export var close_tween: String = ""
## The first focus element: a `Control` in this prefab with a `UIButton` child. `null`: none.
@export var initial_focus: Control = null

## Panel key: the resource key of this prefab. Set by `UICore`; read only.
var panel_key: String = ""
## Param of this panel. `null` is none. Set by `UICore`; read only.
var panel_param: UIParam = null
## Resource scope of this instance. Set by `UICore`; read only.
var scope: Scope = null
## Cache of this panel stack item. `UICore` sets it before `prepare` (`null` for an item never shown); the panel may
## replace it, and `UICore` keeps it in the item when the panel is covered.
var cache: UIPanelCache = null


## Whether the panel takes `param`. The default takes `null` only.
func accepts_param(param: UIParam) -> bool:
	return param == null


## Preparation before the panel shows: server requests for its data, resource loading. May `await`. It does not start
## a panel transition and does not call `UICore.open_popup`. `false` fails the transition.
func prepare(_reason: UICore.PanelOpenReason, _cache: UIPanelCache) -> bool:
	return true


func on_opened(_reason: UICore.PanelOpenReason) -> void:
	pass


func on_closed(_reason: UICore.PanelCloseReason) -> void:
	pass


## Called for back input with back policy `CUSTOM`.
func on_back() -> void:
	pass
