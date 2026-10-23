extends RefCounted
## One of the two BGM players, the BGM on it and its fade.

const _RECORD := preload("res://core/sound_core/sound_bgm_record.gd")

var player: AudioStreamPlayer = null
## BGM on the player. `null` while the player is stopped.
var record: _RECORD = null
## Playback volume: linear, 0 to 1.
var volume: float = 0.0
var fading: bool = false
var fade_from: float = 0.0
var fade_to: float = 0.0
var fade_ms: int = 0
## Real elapsed time of the fade, without the time under global pause.
var fade_elapsed_ms: int = 0
## Stops the player when the fade ends.
var stop_at_end: bool = false
