extends RefCounted
## One change of a playing tween: the values copied from the `TweenChange` when the tween started, and its progress.

var property: int = 0
var target: Vector4 = Vector4.ZERO
var use_start: bool = false
var start_value: Vector4 = Vector4.ZERO
var duration: int = 0
var delay: int = 0
var easing: int = 0
## The delay ended in this cycle and `start` holds the start value.
var started: bool = false
## The target value is set in this cycle.
var finished: bool = false
## The target was an arranged element when the change started in this cycle. Set together with `started`.
var arranged: bool = false
var start: Vector4 = Vector4.ZERO
