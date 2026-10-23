class_name QualityCoreDev
extends RefCounted
## DEV operations of `QualityCore`.


## Applies `level` without saving it. No auto downgrade until `QualityCore.release`.
static func set_test_level(level: QualityCore.QualityLevel) -> void:
	QualityCore._set_test_level(level)


## The device class detection and the base FPS use these values in place of the values the engine reads: system
## memory bytes, logical processor count and the refresh rate of the device screen in whole Hz. -1 is a value the
## engine could not read. Call it after `init`, before `apply_saved_level`. `QualityCore.release` clears it.
static func set_test_device_info(memory_bytes: int, processor_count: int, refresh_rate: int) -> void:
	QualityCore._set_test_device_info(memory_bytes, processor_count, refresh_rate)
