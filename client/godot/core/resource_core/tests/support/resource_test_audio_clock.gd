extends "res://core/resource_core/resource_audio_clock.gd"
## `ResourceCore` core test helper: the tick and audio server values the leak check reads, set by the test. Put it in
## `ResourceCore._audio_clock` before `init`.

## A power of two, so frame durations are exact floats.
const MIX_RATE: float = 32768.0

## Tick value in microseconds.
var now_usec: int = 1000000
## Start, in microseconds, and frame count of the last audio driver callback.
var callback_usec: int = 0
var callback_frames: int = 0
## Microseconds the audio server's own tick read in `get_time_since_last_mix` comes after `get_ticks_usec`.
var read_lag_usec: int = 0
## When above 0, the next `get_time_to_next_mix` first starts a callback of `switch_frames` frames this many
## microseconds later: a callback that started between the two `get_time_since_last_mix` reads of a frame.
var switch_after_usec: int = 0
var switch_frames: int = 0
## Microseconds the ticks move on before each `get_ticks_usec`, `get_time_since_last_mix` and `get_time_to_next_mix`
## read: the time a frame check spends between its reads.
var read_step_usec: int = 0
## Number of `get_time_to_next_mix` reads: one per frame check that read the clock.
var reads: int = 0


## Moves the ticks `after_usec` on and starts a callback of `frames` frames there.
func start_callback(after_usec: int, frames: int) -> void:
	now_usec += after_usec
	callback_usec = now_usec
	callback_frames = frames


func get_ticks_usec() -> int:
	now_usec += read_step_usec
	return now_usec


func get_time_since_last_mix() -> float:
	now_usec += read_step_usec
	return _since_last_mix()


func get_time_to_next_mix() -> float:
	reads += 1
	now_usec += read_step_usec
	if switch_after_usec > 0:
		start_callback(switch_after_usec, switch_frames)
		switch_after_usec = 0
	return callback_frames / MIX_RATE - _since_last_mix()


func get_mix_rate() -> float:
	return MIX_RATE


func _since_last_mix() -> float:
	return (now_usec + read_lag_usec - callback_usec) / 1000000.0
