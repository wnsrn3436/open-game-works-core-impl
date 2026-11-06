class_name PoolCoreDev
extends RefCounted
## DEV operations of `PoolCore`.

const _TAG: String = "PoolCore"


## Turns the effect skip on or off. While it is on, a `borrow` of an auto-return instance publishes no
## `EffectSpawnedEvent`, and PoolCore takes that instance back before the frame is drawn.
static func set_effect_skip(skipped: bool) -> void:
	if not PoolCore.is_initialized():
		LogCore.log_error(_TAG, "set_effect_skip: not initialized")
		return
	PoolCore._effect_skip = skipped
