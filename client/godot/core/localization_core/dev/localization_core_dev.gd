class_name LocalizationCoreDev
extends RefCounted
## DEV operations of `LocalizationCore`.


## Uses `tag` in place of the device language tag until `LocalizationCore.release`. An empty tag clears it.
static func set_test_device_language(tag: String) -> void:
	LocalizationCore._test_device_language = tag
