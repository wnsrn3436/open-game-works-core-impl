extends RefCounted
## The tick and audio server values the leak check of `ResourceCore` reads to tell that the audio server mixed again
## after an audio stream left the cache. Core tests put in a script that extends this one to set them.


func get_ticks_usec() -> int:
	return Time.get_ticks_usec()


func get_time_since_last_mix() -> float:
	return AudioServer.get_time_since_last_mix()


func get_time_to_next_mix() -> float:
	return AudioServer.get_time_to_next_mix()


func get_mix_rate() -> float:
	return AudioServer.get_mix_rate()
