class_name InputCoreTestFrameProbe
extends Node
## Runs a release from a process callback after every other process callback of a frame, as a device input comes
## before the next frame. Then it injects an action with the pointer ID of that release from its first physics or
## process callback, which comes before the physics and process callbacks of the InputCore core node.

## When true, it injects from `_physics_process`, else from `_process`.
var physics: bool = false
var action: StringName = &""
var pointer_id: int = -1
## Whether the inject pressed the action. It releases the action it pressed right after.
var pressed: bool = false
var done: bool = false
## Its process callbacks so far, and that count when it ran the release and when it injected.
var process_count: int = 0
var release_process_count: int = -1
var inject_process_count: int = -1
## `Engine.get_physics_frames()` when it ran the release and when it injected.
var release_physics_frames: int = -1
var inject_physics_frames: int = -1
var _armed: bool = false
var _release: Callable = Callable()
var _late: _Late = null


## The node whose process callback runs the release: it comes after the process callbacks of the InputCore core node.
class _Late:
	extends Node

	var probe: InputCoreTestFrameProbe = null

	func _init() -> void:
		process_mode = Node.PROCESS_MODE_ALWAYS
		process_priority = 1000

	func _process(_delta: float) -> void:
		probe._run_release()


func _init() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = -1000
	process_physics_priority = -1000
	_late = _Late.new()
	_late.probe = self
	add_child(_late)


## Runs `release` at the end of the next process callbacks and injects at the first callback after it.
func start(release: Callable) -> void:
	done = false
	pressed = false
	_release = release


func _run_release() -> void:
	if not _release.is_valid():
		return
	_release.call()
	_release = Callable()
	release_process_count = process_count
	release_physics_frames = Engine.get_physics_frames()
	_armed = true


func _physics_process(_delta: float) -> void:
	if physics:
		_inject()


func _process(_delta: float) -> void:
	if not physics:
		_inject()
	process_count += 1


func _inject() -> void:
	if not _armed:
		return
	_armed = false
	inject_process_count = process_count
	inject_physics_frames = Engine.get_physics_frames()
	InputCore.inject_action(action, true, 1.0, pointer_id)
	pressed = InputCore.is_pressed(action)
	if pressed:
		InputCore.inject_action(action, false, 0.0, pointer_id)
	done = true
