extends Node
## A node of the SceneCore test scenes that counts its frames, to see whether a node with a `process_mode` of its own
## runs under the scene holder.

var process_count: int = 0
var physics_count: int = 0


func _process(_delta: float) -> void:
	process_count += 1


func _physics_process(_delta: float) -> void:
	physics_count += 1
