class_name PoolCoreTestCounter
extends Node
## Counts `EffectSpawnedEvent`.

var count: int = 0


func on_effect_spawned(_event: EffectSpawnedEvent) -> void:
	count += 1
