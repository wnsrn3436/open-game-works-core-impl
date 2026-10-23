extends Node
## Reads the device monotonic time in the frame start signal (`SceneTree.process_frame`) of a frame F, waits `wait_ms`
## in its process callback of F, and records the TimeCore frame increments that its process callback reads in F+1 and
## the device monotonic time that it reads there after them.

var wait_ms: int = 0
## -1 until F+1.
var real_frame_ms: int = -1
var game_frame_ms: int = -1
## Device monotonic time read in the frame start signal of F, before TimeCore sets the increment of F.
var wait_frame_monotonic_ms: int = -1
## Device monotonic time read in the process callback of F+1, after the increments.
var read_frame_monotonic_ms: int = -1
## `Engine.get_process_frames()` of the latest frame start signal before the wait, then of F.
var _signal_frame: int = -1
var _signal_monotonic_ms: int = -1
var _wait_frame: int = -1


func _ready() -> void:
	get_tree().process_frame.connect(_on_process_frame)


func _exit_tree() -> void:
	if get_tree().process_frame.is_connected(_on_process_frame):
		get_tree().process_frame.disconnect(_on_process_frame)


func _on_process_frame() -> void:
	if _wait_frame >= 0:
		return
	_signal_frame = Engine.get_process_frames()
	_signal_monotonic_ms = Time.get_ticks_msec()


func _process(_delta: float) -> void:
	if real_frame_ms >= 0:
		return
	var frame: int = Engine.get_process_frames()
	if _wait_frame < 0:
		# Waits only in a frame whose frame start signal this probe read.
		if frame != _signal_frame:
			return
		_wait_frame = frame
		wait_frame_monotonic_ms = _signal_monotonic_ms
		OS.delay_msec(wait_ms)
		return
	if frame != _wait_frame + 1:
		return
	real_frame_ms = TimeCore.get_real_frame_ms()
	game_frame_ms = TimeCore.get_game_frame_ms()
	read_frame_monotonic_ms = Time.get_ticks_msec()
