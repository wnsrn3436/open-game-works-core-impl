extends Node
## Core node of NetworkCore: the frame check of its timers, the background return event and the log sender.

## Set by `NetworkCore.release` before it takes the node off the tree.
var released: bool = false


func _process(_delta: float) -> void:
	NetworkCore._on_frame()


func _exit_tree() -> void:
	if not released:
		NetworkCore._on_node_exit(self)


func on_foreground_returned(_event: AppForegroundReturnedEvent) -> void:
	NetworkCore._on_foreground_returned()


func on_log_batch(batch: LogBatch) -> void:
	NetworkCore._send_log_batch(batch)
