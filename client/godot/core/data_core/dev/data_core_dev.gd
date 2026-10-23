class_name DataCoreDev
extends RefCounted
## DEV operations of `DataCore`.


## Reads the built-in data from `location`, a folder path that ends with `/`, until `release`. Only before `init`.
static func set_test_data_location(location: String) -> void:
	if DataCore._is_initialized:
		LogCore.log_error(DataCore._TAG, "set_test_data_location after init")
		return
	DataCore._builtin_location = location
	DataCore._builtin_version_read = false
	DataCore._builtin_version = ""
