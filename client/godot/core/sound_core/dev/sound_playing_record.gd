class_name SoundPlayingRecord
extends RefCounted
## One playing `SoundCore.play` request in the buffer of `SoundCoreDev.get_playing`.

var key: String = ""
var bus: SoundCore.SoundBus = SoundCore.SoundBus.SFX
var priority: int = 0
