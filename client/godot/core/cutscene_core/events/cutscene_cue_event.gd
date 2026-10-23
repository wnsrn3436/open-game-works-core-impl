class_name CutsceneCueEvent
extends EventBase
## `CutsceneCore` event: a `Cue` step ran, in playback or in skip application.

## ID value of the cutscene.
var cutscene_id: int = 0
## `step` of the `Cue` step.
var step: int = 0
var cue: GameData.CutsceneCue = GameData.CutsceneCue.NONE
