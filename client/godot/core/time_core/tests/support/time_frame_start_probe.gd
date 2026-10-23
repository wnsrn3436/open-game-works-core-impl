extends Node
## Waits `wait_ms` in the frame start signal (`SceneTree.process_frame`) of one frame and records what its process
## callback reads from TimeCore in that same frame.

var wait_ms: int = 0
## `Engine.get_process_frames()` of the frame of the wait. -1 until the wait.
var wait_frame: int = -1
## `TimeCore.get_real_time()` read in the frame start signal before the wait.
var real_time_at_signal: int = -1
## Read by the process callback in the frame of the wait. -1 until then.
var read_frame: int = -1
var real_frame_ms: int = -1
var real_time: int = -1


func _ready() -> void:
	get_tree().process_frame.connect(_on_process_frame, CONNECT_ONE_SHOT)


func _on_process_frame() -> void:
	wait_frame = Engine.get_process_frames()
	real_time_at_signal = TimeCore.get_real_time()
	OS.delay_msec(wait_ms)


func _process(_delta: float) -> void:
	if wait_frame < 0 or read_frame >= 0:
		return
	read_frame = Engine.get_process_frames()
	real_frame_ms = TimeCore.get_real_frame_ms()
	real_time = TimeCore.get_real_time()
