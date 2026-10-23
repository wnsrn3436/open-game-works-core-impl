class_name UIPopup
extends Control
## Base of the popup prefab root script. Popups open on the `Popup` layer, several at a time. Only `UICore` calls the
## panel interface methods; override them in the popup class. A popup closes itself with `UICore.close_popup(self)`.

## Back policy of back input that reaches this popup.
@export var back_policy: UICore.BackPolicy = UICore.BackPolicy.CLOSE
## While shown, the UI and world below take no pointer input.
@export var modal: bool = true
## While shown, a dim lies right below.
@export var dim: bool = false
## Tween preset key played on this root after it shows. Empty: none.
@export var open_tween: String = ""
## Tween preset key played on this root before it is destroyed. Empty: none.
@export var close_tween: String = ""
## The first focus element: a `Control` in this prefab with a `UIButton` child. `null`: none.
@export var initial_focus: Control = null

## Popup key: the resource key of this prefab. Set by `UICore`; read only.
var popup_key: String = ""
## Param of this popup. `null` is none. Set by `UICore`; read only.
var popup_param: UIParam = null
## Resource scope of this instance. Set by `UICore`; read only.
var scope: Scope = null
## The `PopupSuppress` given to `UICore.open_popup`, or `null`. Show the suppression toggle only when it is set.
var popup_suppress: PopupSuppress = null


## Whether the popup takes `param`. The default takes `null` only.
func accepts_param(param: UIParam) -> bool:
	return param == null


## Preparation before the popup shows. May `await`. It does not start a panel transition and does not call
## `UICore.open_popup`. `false` fails the open flow.
func prepare() -> bool:
	return true


func on_opened() -> void:
	pass


func on_closed() -> void:
	pass


## Called for back input with back policy `CUSTOM`.
func on_back() -> void:
	pass
