extends SceneBase
## Root script of the ShortcutCore test scenes. Records `on_start` as `scene_start:<short name>` and does what the
## static test config says.

const Trace := preload("res://core/shortcut_core/tests/support/shortcut_trace.gd")
const Gate := preload("res://core/shortcut_core/tests/support/gate.gd")

## When set, `on_prepare` waits for it and returns its result.
static var prepare_gate: Gate = null
## Panel key `on_start` opens on top of the root panel. Empty: none.
static var start_panel: String = ""


static func reset() -> void:
	prepare_gate = null
	start_panel = ""


func on_prepare() -> bool:
	if prepare_gate != null:
		Trace.add("scene_gated:" + Trace.short(scene_key))
		var ok: bool = await prepare_gate.opened
		return ok
	return true


func on_start() -> void:
	Trace.add("scene_start:" + Trace.short(scene_key))
	if start_panel != "":
		var ok: bool = await UICore.open_panel(start_panel, null, false)
		Trace.add("start_panel:%s:%s" % [Trace.short(start_panel), ok])
