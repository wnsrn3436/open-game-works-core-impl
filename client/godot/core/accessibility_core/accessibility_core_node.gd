extends Node
## Core node of `AccessibilityCore`: hides the subtitle whose voice ended every frame and receives
## `SafeAreaChangedEvent`, which follows every change of the visible game area.

## Runs after the frame processing of `SoundCore`, so a voice that ended this frame is seen this frame.
const _PROCESS_PRIORITY: int = 100

## Set by `AccessibilityCore` release so that `_exit_tree` does not clean up a second time.
var released: bool = false


func _init() -> void:
	name = "AccessibilityCore"
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = _PROCESS_PRIORITY


func _process(_delta: float) -> void:
	AccessibilityCore._on_frame()


func _on_safe_area_changed(_event: SafeAreaChangedEvent) -> void:
	AccessibilityCore._fit_filter()


func _exit_tree() -> void:
	if not released:
		AccessibilityCore._on_node_exit()
