class_name TweenDefinition
extends Resource
## A tween definition: steps run one after another, the whole list `repeat_count` times. A tween preset is a
## `TweenDefinition` resource.

@export var steps: Array[TweenStep] = []
## Number of cycles. 0 repeats forever.
@export var repeat_count: int = 1
