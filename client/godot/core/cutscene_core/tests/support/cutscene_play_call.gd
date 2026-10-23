extends RefCounted
## Runs one `CutsceneCore.play` without the test waiting for it, and keeps its result.

signal finished

var done: bool = false
var result: CutsceneResult = null
## Process frame in which the play ended.
var finished_frame: int = -1


func play(cutscene_id: int, scope: Scope, args: FormatArgs, skippable: bool) -> void:
	result = await CutsceneCore.play(cutscene_id, scope, args, skippable)
	done = true
	finished_frame = Engine.get_process_frames()
	finished.emit()


func status() -> CutsceneCore.CutsceneStatus:
	return result.status if result != null else CutsceneCore.CutsceneStatus.FAILED


## `play` with the default arguments and skippable flag.
func play_default(cutscene_id: int, scope: Scope) -> void:
	result = await CutsceneCore.play(cutscene_id, scope)
	done = true
	finished_frame = Engine.get_process_frames()
	finished.emit()
