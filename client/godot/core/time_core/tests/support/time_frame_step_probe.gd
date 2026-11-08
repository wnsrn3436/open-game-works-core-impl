extends Node
## Records, in its process callback of each frame after TimeCore incremented that frame, the TimeCore frame increments,
## real elapsed time, game time and monotonic time, for `frames` frames, from the first frame in which the real elapsed
## time is above 0: the first TimeCore frame at a frame step, whichever frame the probe was added in. Waits `wait_ms` in the process callback of the
## frame `wait_frame` (from 0) after recording it. Runs also while the engine features are paused.

var frames: int = 0
var wait_frame: int = -1
var wait_ms: int = 0
var real_frame_ms: PackedInt64Array = []
var game_frame_ms: PackedInt64Array = []
var real_time: PackedInt64Array = []
var game_time: PackedInt64Array = []
var monotonic_time: PackedInt64Array = []


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func is_done() -> bool:
	return real_frame_ms.size() >= frames


func _process(_delta: float) -> void:
	if is_done():
		return
	if real_frame_ms.is_empty() and TimeCore.get_real_time() == 0:
		return
	real_frame_ms.append(TimeCore.get_real_frame_ms())
	game_frame_ms.append(TimeCore.get_game_frame_ms())
	real_time.append(TimeCore.get_real_time())
	game_time.append(TimeCore.get_game_time())
	monotonic_time.append(TimeCore.get_monotonic_time())
	if real_frame_ms.size() - 1 == wait_frame:
		OS.delay_msec(wait_ms)
