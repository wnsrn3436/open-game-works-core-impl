extends Node
## A node of the default process priority, as a content node is: records the watch callbacks a recorder got when this
## node ran its first frame code.

const _RECORDER := preload("res://core/requirement_core/tests/support/requirement_recorder.gd")

var recorder: _RECORDER = null
## Calls the recorder had at the first `_process`; −1 before it.
var seen: int = -1


func _process(_delta: float) -> void:
	if seen < 0 and recorder != null:
		seen = recorder.count()
