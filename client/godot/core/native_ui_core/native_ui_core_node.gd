extends Node
## Core node of `NativeUiCore`: receives the background events and, while a screen capture waits, the end of the
## drawn frame.

## Set by `NativeUiCore` release so that `_exit_tree` does not clean up a second time.
var released: bool = false


func _init() -> void:
	name = "NativeUiCore"
	process_mode = Node.PROCESS_MODE_ALWAYS


## Starts receiving `RenderingServer.frame_post_draw`. True when it is received after this call.
func start_frame_watch() -> bool:
	if RenderingServer.frame_post_draw.is_connected(_on_frame_post_draw):
		return true
	return RenderingServer.frame_post_draw.connect(_on_frame_post_draw) == OK


func stop_frame_watch() -> void:
	if RenderingServer.frame_post_draw.is_connected(_on_frame_post_draw):
		RenderingServer.frame_post_draw.disconnect(_on_frame_post_draw)


func _on_frame_post_draw() -> void:
	stop_frame_watch()
	NativeUiCore._on_frame_post_draw()


func _on_background_entered(_event: AppBackgroundEnteredEvent) -> void:
	NativeUiCore._on_background_entered()


func _on_foreground_returned(_event: AppForegroundReturnedEvent) -> void:
	NativeUiCore._on_foreground_returned()


func _exit_tree() -> void:
	if not released:
		NativeUiCore._on_node_exit()
