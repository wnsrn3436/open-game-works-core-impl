class_name InputCoreTestRecorder
extends Node
## Records the `InputCore` events, back handler calls, UI pointer observer calls and debug input handler calls of a
## test in order.

## What `on_back` returns.
var back_result: bool = false
## What `on_debug` returns.
var debug_result: bool = false
## Called inside `on_drag` with the event, when set.
var on_drag_hook: Callable = Callable()
var records: Array[InputCoreTestRecord] = []


## Subscribes to every `InputCore` event.
func subscribe_all() -> bool:
	var ok: bool = EventCore.subscribe(InputDeviceChangedEvent, _on_device)
	ok = EventCore.subscribe(TapEvent, _on_tap) and ok
	ok = EventCore.subscribe(LongPressEvent, _on_long_press) and ok
	ok = EventCore.subscribe(DragEvent, _on_drag) and ok
	ok = EventCore.subscribe(SwipeEvent, _on_swipe) and ok
	ok = EventCore.subscribe(PinchEvent, _on_pinch) and ok
	ok = EventCore.subscribe(InputPromptChangedEvent, _on_prompt) and ok
	ok = EventCore.subscribe(GamepadConnectionChangedEvent, _on_gamepad) and ok
	return ok


## Back handler: records the call and returns `back_result`.
func on_back() -> bool:
	_add("back")
	return back_result


## UI pointer observer.
func on_pointer(pointer_id: int, pressed: bool, position: Vector2) -> void:
	var record: InputCoreTestRecord = _add("pointer")
	record.pointer_id = pointer_id
	record.pressed = pressed
	record.position = position


## Connected to a button's `pressed` signal: records the click.
func on_button_pressed() -> void:
	_add("button")


## Debug input handler: records the call and returns `debug_result`.
func on_debug(_event: InputEvent) -> bool:
	_add("debug")
	return debug_result


## Kinds of the records in order.
func kinds() -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	for record: InputCoreTestRecord in records:
		out.append(record.kind)
	return out


## Records of `kind` in order.
func of(kind: String) -> Array[InputCoreTestRecord]:
	var out: Array[InputCoreTestRecord] = []
	for record: InputCoreTestRecord in records:
		if record.kind == kind:
			out.append(record)
	return out


## Number of records of `kind`.
func count(kind: String) -> int:
	return of(kind).size()


## Drag phases in order.
func drag_phases() -> Array[InputCore.GesturePhase]:
	var out: Array[InputCore.GesturePhase] = []
	for record: InputCoreTestRecord in of("drag"):
		out.append(record.phase)
	return out


## Pinch phases in order.
func pinch_phases() -> Array[InputCore.GesturePhase]:
	var out: Array[InputCore.GesturePhase] = []
	for record: InputCoreTestRecord in of("pinch"):
		out.append(record.phase)
	return out


func clear() -> void:
	records.clear()


func _add(kind: String) -> InputCoreTestRecord:
	var record: InputCoreTestRecord = InputCoreTestRecord.new()
	record.kind = kind
	records.append(record)
	return record


func _on_device(event: InputDeviceChangedEvent) -> void:
	_add("device").device = event.device


func _on_tap(event: TapEvent) -> void:
	var record: InputCoreTestRecord = _add("tap")
	record.pointer_id = event.pointer_id
	record.position = event.position


func _on_long_press(event: LongPressEvent) -> void:
	var record: InputCoreTestRecord = _add("long_press")
	record.pointer_id = event.pointer_id
	record.position = event.position


func _on_drag(event: DragEvent) -> void:
	var record: InputCoreTestRecord = _add("drag")
	record.pointer_id = event.pointer_id
	record.phase = event.phase
	record.start_position = event.start_position
	record.position = event.position
	record.delta = event.delta
	if on_drag_hook.is_valid():
		on_drag_hook.call(event)


func _on_swipe(event: SwipeEvent) -> void:
	var record: InputCoreTestRecord = _add("swipe")
	record.pointer_id = event.pointer_id
	record.start_position = event.start_position
	record.end_position = event.end_position


func _on_pinch(event: PinchEvent) -> void:
	var record: InputCoreTestRecord = _add("pinch")
	record.phase = event.phase
	record.center = event.center
	record.scale = event.scale


func _on_prompt(event: InputPromptChangedEvent) -> void:
	_add("prompt").family = event.family


func _on_gamepad(event: GamepadConnectionChangedEvent) -> void:
	var record: InputCoreTestRecord = _add("gamepad")
	record.gamepad_id = event.gamepad_id
	record.connected = event.connected
