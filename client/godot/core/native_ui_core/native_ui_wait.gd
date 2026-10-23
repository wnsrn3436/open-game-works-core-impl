extends RefCounted
## One awaited step of a NativeUiCore async operation. `finish` resumes the waiting operation once; `release`
## finishes every wait so that the operations stop with their failure value.

signal done

## True after `finish`.
var finished: bool = false
## True when the awaited step ended by itself, not cut short by `release`.
var ok: bool = false
## `NativeUiCore.ShareResult` value of a share wait.
var result: int = 0
## PNG bytes of a `capture_screen` wait. Empty when the screen was not read.
var png: PackedByteArray = PackedByteArray()


## Resumes the waiting side. Later calls do nothing.
func finish() -> void:
	if finished:
		return
	finished = true
	done.emit()
