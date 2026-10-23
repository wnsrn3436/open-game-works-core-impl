extends RefCounted
## A gate a test `prepare` waits for until the test opens it.

signal opened

var is_open: bool = false


func open() -> void:
	is_open = true
	opened.emit()
