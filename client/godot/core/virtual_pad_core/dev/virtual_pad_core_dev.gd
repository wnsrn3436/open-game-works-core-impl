class_name VirtualPadCoreDev
extends RefCounted
## DEV operations of `VirtualPadCore`.

const _TAG: String = "VirtualPadCore"


## Sets whether the device supports touch, and decides the state again. `release` drops it.
static func set_test_touch_support(supported: bool) -> void:
	if not VirtualPadCore.is_initialized():
		LogCore.log_error(_TAG, "set_test_touch_support: not initialized")
		return
	VirtualPadCore._touch_supported = supported
	VirtualPadCore._update_state()
