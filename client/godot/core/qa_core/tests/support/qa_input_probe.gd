extends Node
## Records the process frame of every device input the root viewport passes down, and the process frames whose
## process callbacks see `watched` just pressed.

## Action whose just pressed frames are recorded. Empty: none.
var watched: StringName = &""
## `<frame>:<kind>:<detail>` of every input: `touch_down`, `touch_up` and `drag` with the touch index, `key_down` and
## `key_up` with the keycode, `text` with the code point, `mouse_down` and `mouse_up` with the button index.
var inputs: PackedStringArray = PackedStringArray()
var just_pressed_frames: PackedInt64Array = PackedInt64Array()


func _input(event: InputEvent) -> void:
	var frame: int = Engine.get_process_frames()
	if event is InputEventScreenTouch:
		var touch: InputEventScreenTouch = event as InputEventScreenTouch
		inputs.append("%d:%s:%d" % [frame, "touch_down" if touch.pressed else "touch_up", touch.index])
	elif event is InputEventScreenDrag:
		inputs.append("%d:drag:%d" % [frame, (event as InputEventScreenDrag).index])
	elif event is InputEventKey:
		var key: InputEventKey = event as InputEventKey
		if key.keycode == KEY_NONE:
			inputs.append("%d:text:%d" % [frame, key.unicode])
		else:
			inputs.append("%d:%s:%d" % [frame, "key_down" if key.pressed else "key_up", key.keycode])
	elif event is InputEventMouseButton:
		var mouse: InputEventMouseButton = event as InputEventMouseButton
		inputs.append("%d:%s:%d" % [frame, "mouse_down" if mouse.pressed else "mouse_up", mouse.button_index])


func _process(_delta: float) -> void:
	if watched != &"" and InputCore.is_just_pressed(watched):
		just_pressed_frames.append(Engine.get_process_frames())


## The frame of the first input `<kind>:<detail>`; -1 when there is none.
func frame_of(kind: String) -> int:
	for item: String in inputs:
		var at: int = item.find(":")
		if item.substr(at + 1) == kind:
			return item.substr(0, at).to_int()
	return -1


## The inputs of `kind` (`touch_down`, `drag`, ...) from input number `from` on.
func count_of(kind: String, from: int = 0) -> int:
	return frames_of(kind, from).size()


## The frames of the inputs of `kind` from input number `from` on, in order.
func frames_of(kind: String, from: int = 0) -> PackedInt64Array:
	var frames: PackedInt64Array = PackedInt64Array()
	for i: int in range(from, inputs.size()):
		if inputs[i].get_slice(":", 1) == kind:
			frames.append(inputs[i].get_slice(":", 0).to_int())
	return frames
