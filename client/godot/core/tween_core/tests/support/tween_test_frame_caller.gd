extends Node
## Calls `TweenCore.play_preset` once from its frame processing, as core frame code does.

var key: String = ""
var target: Node = null
var options: TweenOptions = null
var handle: int = 0
var called: bool = false


func _process(_delta: float) -> void:
	if called:
		return
	called = true
	handle = TweenCore.play_preset(key, ResourceCore.get_global_scope(), target, options)
