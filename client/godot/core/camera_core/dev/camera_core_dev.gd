class_name CameraCoreDev
extends RefCounted
## DEV operations of `CameraCore`.

const _TAG: String = "CameraCore"


## Sets the random seed of the shake noise. The same seed and the same input give the same offsets.
static func set_shake_seed(seed_value: int) -> void:
	if not CameraCore.is_initialized():
		LogCore.log_error(_TAG, "set_shake_seed: not initialized")
		return
	CameraCore._reseed(seed_value)


## Turns the shake skip on or off. While it is on, a `shake` that passes its checks adds no trauma and publishes no
## `CameraShakeStartedEvent`; the trauma that is there and the shake scale stay as they are.
static func set_shake_skip(skipped: bool) -> void:
	if not CameraCore.is_initialized():
		LogCore.log_error(_TAG, "set_shake_skip: not initialized")
		return
	CameraCore._shake_skip = skipped
