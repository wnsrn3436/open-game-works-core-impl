extends RefCounted
## The wait of one `CutsceneCore.play`: it ends with the result of the playback.

signal done

var finished: bool = false
var result: CutsceneResult = null


func finish(value: CutsceneResult) -> void:
	if finished:
		return
	finished = true
	result = value
	done.emit()
