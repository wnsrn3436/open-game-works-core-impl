class_name ResourceCoreDev
extends RefCounted
## DEV operations of `ResourceCore`.

const _TAG: String = "ResourceCore"


## Reference count of each cached resource by resource key. Empty before `init` and after `release`.
static func list_loaded_resources() -> Dictionary[String, int]:
	var loaded: Dictionary[String, int] = {}
	if not ResourceCore.is_initialized():
		LogCore.log_error(_TAG, "list_loaded_resources before init or after release")
		return loaded
	for key: String in ResourceCore._cache:
		loaded[key] = ResourceCore._cache[key].reference_count
	return loaded


## Scopes that are not released, in creation order. Empty before `init` and after `release`.
static func list_scopes() -> Array[Scope]:
	if not ResourceCore.is_initialized():
		LogCore.log_error(_TAG, "list_scopes before init or after release")
		return []
	return ResourceCore._scopes.duplicate()


## Before `init` only: the next `init` finds resource keys in `keys` (resource key to engine path) instead of the
## resource key list file. `variants` holds the variant count of each key with two or more variants; a key not in it
## has one. As in the resource key list file, such a key's engine path is not a file: its variant `<n>` (from 1) file
## puts `.<n>` before the extension, so variant 1 of `a/hit.tres` is `a/hit.1.tres`. `release` clears both.
static func set_test_key_list(keys: Dictionary[String, String], variants: Dictionary[String, int] = {}) -> void:
	if ResourceCore.is_initialized():
		LogCore.log_error(_TAG, "set_test_key_list after init")
		return
	ResourceCore._test_key_list = keys.duplicate()
	ResourceCore._test_variants = variants.duplicate()
	ResourceCore._has_test_key_list = true
