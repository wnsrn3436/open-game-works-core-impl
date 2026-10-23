extends RefCounted
## A gate the BootstrapCore core tests open.

signal opened


func open() -> void:
	opened.emit()
