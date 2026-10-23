extends Node
## Records the SafeAreaCore events in delivery order, with the values the subscriber saw at delivery.

## One entry per event: `safe` or `keyboard` while the callback runs, then `/safe` or `/keyboard` when it returns.
var order: PackedStringArray = PackedStringArray()
## Payload insets of each `SafeAreaChangedEvent`.
var payload_insets: Array[Vector4] = []
## `get_inset` of each side at each `SafeAreaChangedEvent`.
var read_insets: Array[Vector4] = []
## Global rectangle of `watched_root` at each `SafeAreaChangedEvent`.
var root_rects: Array[Rect2] = []
## `get_safe_area` at each `SafeAreaChangedEvent`.
var safe_areas: Array[Rect2] = []
## Payload area of each `KeyboardAreaChangedEvent`.
var payload_areas: Array[Rect2] = []
## `get_keyboard_area` at each `KeyboardAreaChangedEvent`.
var read_areas: Array[Rect2] = []
var watched_root: SafeAreaRoot = null
## Called once in the first `SafeAreaChangedEvent`, then cleared.
var on_first_safe_area: Callable = Callable()


func subscribe() -> void:
	EventCore.subscribe(SafeAreaChangedEvent, _on_safe_area_changed)
	EventCore.subscribe(KeyboardAreaChangedEvent, _on_keyboard_area_changed)


func safe_count() -> int:
	return payload_insets.size()


func keyboard_count() -> int:
	return payload_areas.size()


func _on_safe_area_changed(event: SafeAreaChangedEvent) -> void:
	order.append("safe")
	payload_insets.append(Vector4(event.inset_left, event.inset_top, event.inset_right, event.inset_bottom))
	read_insets.append(Vector4(
		SafeAreaCore.get_inset(SafeAreaCore.Edge.LEFT),
		SafeAreaCore.get_inset(SafeAreaCore.Edge.TOP),
		SafeAreaCore.get_inset(SafeAreaCore.Edge.RIGHT),
		SafeAreaCore.get_inset(SafeAreaCore.Edge.BOTTOM),
	))
	safe_areas.append(SafeAreaCore.get_safe_area())
	if watched_root != null:
		root_rects.append(watched_root.get_global_rect())
	if on_first_safe_area.is_valid():
		var callback: Callable = on_first_safe_area
		on_first_safe_area = Callable()
		callback.call()
	order.append("/safe")


func _on_keyboard_area_changed(event: KeyboardAreaChangedEvent) -> void:
	order.append("keyboard")
	payload_areas.append(event.area)
	read_areas.append(SafeAreaCore.get_keyboard_area())
	order.append("/keyboard")
