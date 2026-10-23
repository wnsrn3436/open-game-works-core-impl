extends "res://core/auth_core/adapters/token_storage.gd"
## DEV login token storage of a run with DEV code that is not a browser runtime and has no `ogw-secure-storage`
## singleton: a dev run on a host with no plugin build, and core tests. Each item name (the scope text) has its own
## file `user://ogw_dev_tokens/<scope text>.json` that holds the item text, so runs with different scope text never
## write the same file. A name that is not a valid file name fails every operation.

const DIR: String = "user://ogw_dev_tokens"


## File of the item `name`.
static func item_path(name: String) -> String:
	return "%s/%s.json" % [DIR, name]


func read_item(name: String) -> Outcome:
	if not _valid_name(name):
		return Outcome.new(Status.FAILED)
	var path: String = item_path(name)
	if not FileAccess.file_exists(path):
		return Outcome.new(Status.NOT_FOUND)
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return Outcome.new(Status.FAILED)
	var text: String = file.get_as_text()
	file.close()
	return Outcome.new(Status.OK, text)


## Writes the file through a temporary file, so that a failed write leaves the previous file.
func write_item(name: String, text: String) -> Outcome:
	if not _valid_name(name):
		return Outcome.new(Status.FAILED)
	if DirAccess.make_dir_recursive_absolute(DIR) != OK:
		return Outcome.new(Status.FAILED)
	var path: String = item_path(name)
	var temp_path: String = path + ".tmp"
	var file: FileAccess = FileAccess.open(temp_path, FileAccess.WRITE)
	if file == null:
		return Outcome.new(Status.FAILED)
	var stored: bool = file.store_string(text)
	file.close()
	if not stored or DirAccess.rename_absolute(temp_path, path) != OK:
		return Outcome.new(Status.FAILED)
	return Outcome.new(Status.OK)


func remove_item(name: String) -> Outcome:
	if not _valid_name(name):
		return Outcome.new(Status.FAILED)
	var path: String = item_path(name)
	if not FileAccess.file_exists(path):
		return Outcome.new(Status.NOT_FOUND)
	return Outcome.new(Status.OK if DirAccess.remove_absolute(path) == OK else Status.FAILED)


static func _valid_name(name: String) -> bool:
	return not name.is_empty() and name.is_valid_filename()
