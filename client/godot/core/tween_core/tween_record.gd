extends RefCounted
## One playing tween in a `TweenCore` slot: the definition copied when it started and its progress. A slot keeps its
## record and its change objects for the next tween.

const _CHANGE := preload("res://core/tween_core/change_state.gd")
const _WAITER := preload("res://core/tween_core/end_waiter.gd")

var handle: int = 0
## A `play_value` tween. It has no target object, tag, callback or input block.
var is_value: bool = false
var target_id: int = 0
var receiver: Callable = Callable()
var value_kind: int = 0
## A `play_preset` tween that waits for its tween preset.
var pending: bool = false
## Started with an end condition in the playing operation: it ends with `Completed` before the frame ends.
var end_due: bool = false
## Its end processing runs. Ending it again does nothing.
var ending: bool = false
var time_basis: int = 0
var tag: String = ""
var callback: Callable = Callable()
var block_token: int = 0
## Time of the last progress in the time basis of the tween.
var last_time: int = 0
var repeat_count: int = 1
var cycle_ms: int = 0
var cycle_index: int = 0
var step_index: int = 0
## Time in the current step.
var step_elapsed: int = 0
var step_count: int = 0
## Index of the first change of each step in `changes`, the number of changes and the largest delay + duration.
var step_first: PackedInt32Array = PackedInt32Array()
var step_size: PackedInt32Array = PackedInt32Array()
var step_max: PackedInt32Array = PackedInt32Array()
var change_count: int = 0
var changes: Array[_CHANGE] = []
## Property mask of every change of the definition. `Color` and `Opacity` share one bit.
var mask: int = 0
## Made by the first `wait_end` of this tween.
var waiter: _WAITER = null


## Makes the record free for the next tween. Keeps the step arrays and change objects.
func reset() -> void:
	handle = 0
	is_value = false
	target_id = 0
	receiver = Callable()
	value_kind = 0
	pending = false
	end_due = false
	ending = false
	time_basis = 0
	tag = ""
	callback = Callable()
	block_token = 0
	last_time = 0
	repeat_count = 1
	cycle_ms = 0
	cycle_index = 0
	step_index = 0
	step_elapsed = 0
	step_count = 0
	change_count = 0
	mask = 0
	waiter = null


## Makes room for `steps` steps and `count` changes.
func reserve(steps: int, count: int) -> void:
	if step_first.size() < steps:
		step_first.resize(steps)
		step_size.resize(steps)
		step_max.resize(steps)
	while changes.size() < count:
		changes.append(_CHANGE.new())


## Clears the progress of every change for a new cycle.
func reset_cycle() -> void:
	for i: int in change_count:
		var change: _CHANGE = changes[i]
		change.started = false
		change.finished = false
