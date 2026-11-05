class_name LocalizationCoreDev
extends RefCounted
## DEV operations of `LocalizationCore`.

## The largest magnitude of a device timezone offset that `set_test_timezone_offset` takes: one day less 1 ms.
const _MAX_TIMEZONE_OFFSET_MS: int = 86399999


## Uses `tag` in place of the device language tag until `LocalizationCore.release`. An empty tag clears it.
static func set_test_device_language(tag: String) -> void:
	LocalizationCore._test_device_language = tag


## Uses `offset_ms` in place of the device timezone offset until `LocalizationCore.release`. An offset outside
## -86399999 to 86399999 is an error and leaves the offset in use unchanged.
static func set_test_timezone_offset(offset_ms: int) -> void:
	if offset_ms < -_MAX_TIMEZONE_OFFSET_MS or offset_ms > _MAX_TIMEZONE_OFFSET_MS:
		LogCore.log_error(LocalizationCore._TAG, "set_test_timezone_offset got %d, outside -%d to %d" % [
			offset_ms, _MAX_TIMEZONE_OFFSET_MS, _MAX_TIMEZONE_OFFSET_MS])
		return
	LocalizationCore._test_timezone_offset_set = true
	LocalizationCore._test_timezone_offset_ms = offset_ms
