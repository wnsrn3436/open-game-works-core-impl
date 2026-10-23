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
