extends Node
## Injects inputs from a process callback after every other process callback of a frame, as an automation channel
## input after the content code. Set `process_priority` before it enters the tree to inject at another point.

## Input steps the next process callback calls in order, such as `InputCoreDev.inject_device_input` bound to an input.
var steps: Array[Callable] = []
var done: bool = false


func _init() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = 1000000


func _process(_delta: float) -> void:
	if steps.is_empty():
		return
	for step: Callable in steps:
		step.call()
	steps = []
	done = true
