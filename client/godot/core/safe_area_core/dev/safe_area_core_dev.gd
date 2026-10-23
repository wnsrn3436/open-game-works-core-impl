class_name SafeAreaCoreDev
extends RefCounted
## DEV operations of `SafeAreaCore`.

const _TAG: String = "SafeAreaCore"
const _NO_VIRTUAL_KEYBOARD: int = -1


## While the virtual notch is set, the OS safe area is the whole window less these distances (window pixels) from the
## left, top, right and bottom sides.
static func set_virtual_notch(left: int, top: int, right: int, bottom: int) -> void:
	if not SafeAreaCore._is_initialized:
		LogCore.log_error(_TAG, "set_virtual_notch: not initialized")
		return
	if left < 0 or top < 0 or right < 0 or bottom < 0:
		LogCore.log_error(_TAG, "set_virtual_notch: a distance is negative")
		return
	SafeAreaCore._has_virtual_notch = true
	SafeAreaCore._virtual_notch = Vector4i(left, top, right, bottom)
	SafeAreaCore._recalculate(false)


static func clear_virtual_notch() -> void:
	if not SafeAreaCore._is_initialized:
		LogCore.log_error(_TAG, "clear_virtual_notch: not initialized")
		return
	SafeAreaCore._has_virtual_notch = false
	SafeAreaCore._virtual_notch = Vector4i.ZERO
	SafeAreaCore._recalculate(false)


## While the virtual keyboard is set, the OS keyboard height is `height` (window pixels) on every platform.
static func set_virtual_keyboard(height: int) -> void:
	if not SafeAreaCore._is_initialized:
		LogCore.log_error(_TAG, "set_virtual_keyboard: not initialized")
		return
	if height < 0:
		LogCore.log_error(_TAG, "set_virtual_keyboard: the height is negative")
		return
	SafeAreaCore._virtual_keyboard_height = height
	SafeAreaCore._update_keyboard_area()


static func clear_virtual_keyboard() -> void:
	if not SafeAreaCore._is_initialized:
		LogCore.log_error(_TAG, "clear_virtual_keyboard: not initialized")
		return
	SafeAreaCore._virtual_keyboard_height = _NO_VIRTUAL_KEYBOARD
	SafeAreaCore._update_keyboard_area()
