extends Node
## Counts `RestartRequestedEvent`.

var count: int = 0
var modules: PackedStringArray = PackedStringArray()


func on_restart_requested(event: RestartRequestedEvent) -> void:
	count += 1
	modules.append(event.module)
