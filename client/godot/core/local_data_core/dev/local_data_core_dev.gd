class_name LocalDataCoreDev
extends RefCounted
## DEV operations of `LocalDataCore`.


## Makes every path and local data file relative to `folder` under app storage instead of the app storage root.
## `folder` follows the file operation path rules and may be missing: the first write makes it. Called only before
## `LocalDataCore.init`. `LocalDataCore.release` puts the app storage root back.
static func set_test_storage_root(folder: String) -> void:
	if LocalDataCore.is_initialized():
		LogCore.log_error(LocalDataCore._TAG, "set_test_storage_root after init is ignored")
		return
	if not LocalDataCore._is_valid_path(folder):
		LogCore.log_error(LocalDataCore._TAG, "set_test_storage_root got an invalid folder path")
		return
	LocalDataCore._test_storage_root = folder
