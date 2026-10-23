extends RefCounted
## A point where a test scene or panel callback waits until the test opens it.

signal opened(ok: bool)


func open(ok: bool = true) -> void:
	opened.emit(ok)
