class_name AccessibilityCoreDev
extends RefCounted
## DEV operations of `AccessibilityCore`.

const _TAG: String = "AccessibilityCore"
const _MIN_TEST_TEXT_SCALE: int = 1000


## Applies the text scale `permille` (1000 or more) without saving it or changing the option value. It stays until
## `LocalizationCore.release`, the next `apply_saved_settings`, the next call or a `set_text_scale` or
## `reset_settings` that changes the text scale option value.
static func set_test_text_scale(permille: int) -> void:
	if not AccessibilityCore._is_initialized:
		LogCore.log_error(_TAG, "set_test_text_scale called before init")
		return
	if permille < _MIN_TEST_TEXT_SCALE:
		LogCore.log_error(_TAG, "set_test_text_scale got %d, less than 1000" % permille)
		return
	LocalizationCore.set_text_scale(permille)
