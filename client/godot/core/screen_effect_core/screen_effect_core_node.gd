extends Node
## Core node of `ScreenEffectCore`: watches the owners and the playing tweens every frame and receives
## `GameAreaChangedEvent`.

## Runs after the frame processing of `TweenCore`, so a tween that ended this frame is seen this frame.
const _PROCESS_PRIORITY: int = 100

## Set by `ScreenEffectCore` release so that `_exit_tree` does not clean up a second time.
var released: bool = false


func _init() -> void:
	name = "ScreenEffectCore"
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = _PROCESS_PRIORITY


func _process(_delta: float) -> void:
	ScreenEffectCore._on_frame()


func _on_game_area_changed(_event: GameAreaChangedEvent) -> void:
	ScreenEffectCore._fit_overlays()


func _exit_tree() -> void:
	if not released:
		ScreenEffectCore._on_node_exit()
