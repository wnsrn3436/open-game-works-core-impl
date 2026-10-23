class_name InputCoreTestContentReader
extends Node
## Reads the action state of `action` in its process callback, as content code does, and runs an input from a process
## callback after every other process callback of a frame, as an input that comes after the content code of a frame.

var action: StringName = &""
## `Engine.get_process_frames()` of each of its process callbacks → the `state` read there.
var reads: Dictionary[int, String] = {}
## `Engine.get_process_frames()` when it ran the input, -1 before.
var input_frame: int = -1
var _input: Callable = Callable()


## The node whose process callback runs the input: it comes after the other process callbacks of the frame.
class _Late:
	extends Node

	var reader: InputCoreTestContentReader = null

	func _init() -> void:
		process_mode = Node.PROCESS_MODE_ALWAYS
		process_priority = 1000

	func _process(_delta: float) -> void:
		reader._run_input()


func _init() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var late: _Late = _Late.new()
	late.reader = self
	add_child(late)


## Runs `input` at the end of the next process callbacks.
func run_late(input: Callable) -> void:
	input_frame = -1
	_input = input


func _run_input() -> void:
	if not _input.is_valid():
		return
	var input: Callable = _input
	_input = Callable()
	input_frame = Engine.get_process_frames()
	input.call()


func _process(_delta: float) -> void:
	reads[Engine.get_process_frames()] = state(InputCore.is_pressed(action), InputCore.is_just_pressed(action),
		InputCore.is_just_released(action))


## The read of `frame`, empty when it did not read that frame.
func read(frame: int) -> String:
	return reads.get(frame, "")


## `is_pressed`, `is_just_pressed` and `is_just_released` as a read.
static func state(pressed: bool, just_pressed: bool, just_released: bool) -> String:
	return "pressed=%s just_pressed=%s just_released=%s" % [pressed, just_pressed, just_released]
