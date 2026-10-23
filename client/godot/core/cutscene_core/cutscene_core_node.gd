extends Node
## Core node of `CutsceneCore`: runs the frame processing of the playback, sees the input events before the GUI stage
## and receives the `animation_finished` signals of the animations and stagings it plays.

## Runs after the frame processing of `TweenCore` and `ScreenEffectCore`, so a tween that ended this frame is seen this
## frame.
const _PROCESS_PRIORITY: int = 200

## Set by `CutsceneCore.release` so that `_exit_tree` does not clean up a second time.
var released: bool = false


func _init() -> void:
	name = "CutsceneCore"
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = _PROCESS_PRIORITY


func _input(event: InputEvent) -> void:
	CutsceneCore._on_input(event)


func _process(_delta: float) -> void:
	CutsceneCore._on_frame()


func _on_animation_finished(animation: StringName, serial: int) -> void:
	CutsceneCore._on_animation_finished(animation, serial)


func _exit_tree() -> void:
	if not released:
		CutsceneCore._on_node_exit()
