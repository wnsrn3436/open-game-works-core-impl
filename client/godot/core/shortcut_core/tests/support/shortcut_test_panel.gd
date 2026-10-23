extends UIPanel
## Root script of the ShortcutCore test panels. Takes any param, records the param it shows with, and fails or waits
## in `prepare` as the static test config and `fail` say.

const Trace := preload("res://core/shortcut_core/tests/support/shortcut_trace.gd")
const Gate := preload("res://core/shortcut_core/tests/support/gate.gd")

## Param of the last `on_opened` by short name.
static var shown_params: Dictionary[String, UIParam] = {}
## When set, `prepare` of a `New` open waits for it.
static var new_gate: Gate = null
## When set, `prepare` of a `Returned` open waits for it.
static var returned_gate: Gate = null

## `prepare` returns `false`.
@export var fail: bool = false


static func reset() -> void:
	shown_params = {}
	new_gate = null
	returned_gate = null


func accepts_param(_param: UIParam) -> bool:
	return true


func prepare(reason: UICore.PanelOpenReason, _cache: UIPanelCache) -> bool:
	var gate: Gate = new_gate if reason == UICore.PanelOpenReason.NEW else returned_gate
	if gate != null:
		Trace.add("panel_gated:" + Trace.short(panel_key))
		var ok: bool = await gate.opened
		return ok and not fail
	return not fail


func on_opened(_reason: UICore.PanelOpenReason) -> void:
	shown_params[Trace.short(panel_key)] = panel_param
