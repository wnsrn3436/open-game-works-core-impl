extends RefCounted
## One active tutorial: its step and step progress.

const _DEF := preload("res://core/tutorial_core/tutorial_def.gd")
const _STEP := preload("res://core/tutorial_core/tutorial_step_def.gd")
const _WAIT := preload("res://core/tutorial_core/tutorial_block_wait.gd")

## `WAITING`: step progress 2 (`Paused`). `SHOWN`: step progress 3 to 5 (`Shown`). `STOPPED`: step progress stopped
## between `SceneEndedEvent` and `SceneStartedEvent` (`Paused`).
enum Stage { WAITING, SHOWN, STOPPED }

var def: _DEF = null
## Index of the current step in `def.steps`.
var index: int = 0
var stage: Stage = Stage.WAITING
## UI element of the anchor lookup at stage 3, or `null`.
var element: Control = null
## The view focus of this step was set.
var has_focus: bool = false
## Block wait of the reason tag `tutorial` block of this step, or `null`.
var block: _WAIT = null
## Real elapsed time at which the step screen condition began to hold without the step anchor condition. -1: not now.
var anchor_wait_from: int = -1
## The anchor wait warn log of this step was written.
var anchor_warned: bool = false
## A `complete_requirement` watch of this step is on.
var watching: bool = false
## The `AnchorTap` condition was met by a release; the step ends in the deferred call.
var tap_met: bool = false
## Pointer IDs pressed inside the anchor rectangle and not released yet.
var press_pointers: Dictionary[int, bool] = {}
## Counts the steps this tutorial started. A deferred `AnchorTap` end of an earlier step does nothing.
var serial: int = 0


func current() -> _STEP:
	return def.steps[index]
