class_name VirtualPadTestRecorder
extends Node
## Counts the `InputCore` gesture events of the VirtualPadCore core tests.

var taps: int = 0
var long_presses: int = 0
var drags: int = 0
var swipes: int = 0


func subscribe_all() -> bool:
	return EventCore.subscribe(TapEvent, _on_tap) and EventCore.subscribe(LongPressEvent, _on_long_press) \
		and EventCore.subscribe(DragEvent, _on_drag) and EventCore.subscribe(SwipeEvent, _on_swipe)


## Every gesture event counted.
func gestures() -> int:
	return taps + long_presses + drags + swipes


func _on_tap(_event: TapEvent) -> void:
	taps += 1


func _on_long_press(_event: LongPressEvent) -> void:
	long_presses += 1


func _on_drag(_event: DragEvent) -> void:
	drags += 1


func _on_swipe(_event: SwipeEvent) -> void:
	swipes += 1
