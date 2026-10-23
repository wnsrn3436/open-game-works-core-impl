class_name HapticLogRecord
extends RefCounted
## One `SoundCore.play_haptic` request in the buffer of `SoundCoreDev.get_haptic_log`.

var key: String = ""
## Whether the request played its pattern.
var played: bool = false
var target: SoundCore.HapticTarget = SoundCore.HapticTarget.DEVICE
