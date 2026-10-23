extends Node
## Records what a tween test watches: completion callbacks, `TweenStartedEvent`, `wait_end` results and value
## receiver calls, in one order log.

## `end:<reason>` for each completion callback and `started` for each `TweenStartedEvent`, in call order.
var order: PackedStringArray = PackedStringArray()
var reasons: PackedInt32Array = PackedInt32Array()
var started_count: int = 0
## `wait_end` results by the index `wait` was given.
var waits: Dictionary[int, int] = {}
var floats: PackedFloat64Array = PackedFloat64Array()
var vectors: PackedVector2Array = PackedVector2Array()
var colors: PackedColorArray = PackedColorArray()


func on_end(reason: TweenCore.TweenEndReason) -> void:
	reasons.append(reason)
	order.append("end:%d" % reason)


func on_started(_event: TweenStartedEvent) -> void:
	started_count += 1
	order.append("started")


func on_float(value: float) -> void:
	floats.append(value)


func on_vector(value: Vector2) -> void:
	vectors.append(value)


func on_color(value: Color) -> void:
	colors.append(value)


## Waits for the end of `handle` and keeps the result at `index`. Not awaited by the caller.
func wait(handle: int, index: int) -> void:
	var reason: TweenCore.TweenEndReason = await TweenCore.wait_end(handle)
	waits[index] = reason


func subscribe_started() -> bool:
	return EventCore.subscribe(TweenStartedEvent, on_started)
