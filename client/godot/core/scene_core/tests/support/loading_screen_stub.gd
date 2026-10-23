extends LoadingScreenBase
## Root script of the SceneCore test loading screen. Records its callbacks in the scene trace and keeps the progress
## values it got. Optionally fades the `Transition` channel to opaque in `on_show`.

const Trace := preload("res://core/scene_core/tests/support/scene_trace.gd")
const Gate := preload("res://core/scene_core/tests/support/gate.gd")

## Instances made since the last `reset`.
static var made_count: int = 0
## Progress values of every `on_progress`, in order.
static var progress: PackedInt32Array = PackedInt32Array()
## When set, `on_show` waits for it.
static var show_gate: Gate = null
## When set, `on_hide` waits for it.
static var hide_gate: Gate = null
## `on_show` fades the `Transition` channel to opaque black and leaves it so.
static var fade_on_show: bool = false

## The full screen background with the ignore mark.
@export var background: Control = null


static func reset() -> void:
	made_count = 0
	progress = PackedInt32Array()
	show_gate = null
	hide_gate = null
	fade_on_show = false


func _init() -> void:
	made_count += 1


func on_show(_scene_key: String) -> void:
	Trace.add("loading_show")
	if fade_on_show:
		ScreenEffectCore.fade(ScreenEffectCore.ScreenEffectChannel.TRANSITION, self, Color.BLACK, 1.0, 1.0, 0)
	if show_gate != null:
		await show_gate.wait()


func on_progress(progress_permille: int) -> void:
	progress.append(progress_permille)


func on_hide() -> void:
	Trace.add("loading_hide")
	if hide_gate != null:
		await hide_gate.wait()
