class_name CutsceneResult
extends RefCounted
## Result of `CutsceneCore.play`.

var status: CutsceneCore.CutsceneStatus = CutsceneCore.CutsceneStatus.FAILED
## The choices picked with choice input during the playback, in the order they were picked.
var choices: Array[CutsceneChoiceRecord] = []
