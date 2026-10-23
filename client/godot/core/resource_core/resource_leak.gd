extends RefCounted
## A resource taken out of the cache that the leak check looks at once its wait ended (`ResourceCore._is_due`).

var reference: WeakRef = null
var key: String = ""
## Name of the scope that dropped the last reference.
var scope_name: String = ""
## Process frame the resource left the cache in.
var frame: int = 0
## `Time.get_ticks_usec()` value when the resource left the cache.
var left_usec: int = 0
## The resource is an `AudioStream`, which a stopped playback holds until the audio server mixes it out.
var audio: bool = false
## Sum of the frame counts of the audio driver callbacks counted since the resource left the cache.
var mix_frames: int = 0
## Start, in `Time.get_ticks_usec()` microseconds, of the last callback counted in `mix_frames`. -1 before.
var counted_callback_usec: int = -1
## Process frame that saw `mix_frames` pass the audio server's mix size, so the audio server mixed again since the
## resource left the cache. -1 before.
var mixed_frame: int = -1
