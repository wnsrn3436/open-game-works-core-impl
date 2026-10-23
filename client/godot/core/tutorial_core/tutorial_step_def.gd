extends RefCounted
## One `tutorial_step` row as `TutorialCore` reads it. Copied from the data when the tutorial definitions are made.

var step: int = 0
## Translation key of the speech bubble text. Empty: none.
var text: String = ""
var anchor: String = ""
## Anchor key of the anchor lookup. 0: null.
var anchor_key: int = 0
## Panel key. Empty: null.
var panel: String = ""
## Popup key. Empty: null.
var popup: String = ""
var pointer: bool = false
var restrict_input: bool = false
var complete: GameData.TutorialComplete = GameData.TutorialComplete.NONE
var complete_requirement: int = 0
## `NONE`: null.
var cue: GameData.TutorialCue = GameData.TutorialCue.NONE
var save: bool = false
