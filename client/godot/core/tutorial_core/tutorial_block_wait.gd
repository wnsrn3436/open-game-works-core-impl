extends RefCounted
## The async operation `TutorialCore` gives to `InputBlockCore.run_blocked`: it waits until `finish` and returns
## `true`, which lifts the reason tag `tutorial` block.

signal done

var finished: bool = false


func run() -> bool:
	if not finished:
		await done
	return true


func finish() -> void:
	if finished:
		return
	finished = true
	done.emit()
