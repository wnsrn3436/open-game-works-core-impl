extends RefCounted
## One `tutorial` row and its steps in `step` order, as `TutorialCore` reads them.

const _STEP := preload("res://core/tutorial_core/tutorial_step_def.gd")

var id: int = 0
var order: int = 0
var start_requirement: int = 0
var skippable: bool = false
var steps: Array[_STEP] = []


## `step` of the last step, or 0 when there is no step.
func last_step() -> int:
	return steps[steps.size() - 1].step if not steps.is_empty() else 0
