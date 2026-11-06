class_name TweenCoreDev
extends RefCounted
## DEV operations of `TweenCore`.

const _TAG: String = "TweenCore"


## Turns the finite skip on or off. While it is on, a tween requested then that does not repeat forever ends with
## `Completed` at its end state before the frame ends, without progress and without `TweenStartedEvent`.
static func set_finite_skip(skipped: bool) -> void:
	if not TweenCore.is_initialized():
		LogCore.log_error(_TAG, "set_finite_skip: not initialized")
		return
	TweenCore._finite_skip = skipped
