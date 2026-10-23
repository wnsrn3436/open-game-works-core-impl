class_name InputCoreTestCounter
extends Node
## Counts the `InputCore` events by kind without allocating, for the memory tests.

var device: int = 0
var prompt: int = 0
var tap: int = 0
var drag: int = 0
var swipe: int = 0
var pinch: int = 0


## Subscribes to the `InputCore` events that device input publishes.
func subscribe_all() -> bool:
	var ok: bool = EventCore.subscribe(InputDeviceChangedEvent, _on_device)
	ok = EventCore.subscribe(InputPromptChangedEvent, _on_prompt) and ok
	ok = EventCore.subscribe(TapEvent, _on_tap) and ok
	ok = EventCore.subscribe(DragEvent, _on_drag) and ok
	ok = EventCore.subscribe(SwipeEvent, _on_swipe) and ok
	ok = EventCore.subscribe(PinchEvent, _on_pinch) and ok
	return ok


func total() -> int:
	return device + prompt + tap + drag + swipe + pinch


func _on_device(_event: InputDeviceChangedEvent) -> void:
	device += 1


func _on_prompt(_event: InputPromptChangedEvent) -> void:
	prompt += 1


func _on_tap(_event: TapEvent) -> void:
	tap += 1


func _on_drag(_event: DragEvent) -> void:
	drag += 1


func _on_swipe(_event: SwipeEvent) -> void:
	swipe += 1


func _on_pinch(_event: PinchEvent) -> void:
	pinch += 1
