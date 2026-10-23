class_name LocalDataCore
extends RefCounted
## Stores local data (keys and values) in the app storage of the device, and reads and writes the files of other
## modules atomically.

## File kind of local data: `DEVICE` is one per device, `USER` is one per user ID.
enum FileKind { DEVICE, USER }

## Why a file operation failed.
enum FileError { NONE, INVALID_PATH, NOT_FOUND, TOO_LARGE, NO_SPACE, FAILED }

const _TAG: String = "LocalDataCore"
const _CORE_NODE = preload("res://core/local_data_core/local_data_core_node.gd")
const _FILE_STATE = preload("res://core/local_data_core/local_data_file.gd")
const _ENTRY = preload("res://core/local_data_core/local_data_entry.gd")
const _READER = preload("res://core/local_data_core/local_data_reader.gd")

## Local data file format version. A format change adds 1 and a converter in `_convert` from every earlier version.
const _SCHEMA_VERSION: int = 1
const _LOCAL_DATA_FOLDER: String = "local_data/"
const _DEVICE_FILE: String = "local_data/device.dat"
const _TMP_SUFFIX: String = ".tmp"
const _BAK_SUFFIX: String = ".bak"
## File under the `local_data/` folder that a deleting or renaming file operation opens for writing and closes, so
## that the browser runtime starts its IndexedDB sync.
const _SYNC_FILE: String = "local_data/.sync"
## Folders under the app storage root that file operations do not touch.
const _RESERVED_FOLDERS: PackedStringArray = ["log", "local_data"]
## Hash chunk size: bytes `hash_file` reads at a time.
const _HASH_CHUNK_BYTES: int = 65536
const _SETTING_WRITE_INTERVAL: String = "LocalDataCore.writeIntervalMs"
const _SETTING_FILE_MAX_BYTES: String = "LocalDataCore.fileMaxBytes"

## Value type tags of the local data file. They are also the type of an entry in memory.
const _TYPE_INT: int = 1
const _TYPE_FLOAT: int = 2
const _TYPE_BOOL: int = 3
const _TYPE_STRING: int = 4
const _TYPE_INT_ARRAY: int = 5
const _TYPE_FLOAT_ARRAY: int = 6
const _TYPE_BOOL_ARRAY: int = 7
const _TYPE_STRING_ARRAY: int = 8

## Write failure cause of a serialized file state above `LocalDataCore.fileMaxBytes`. `FileError` values are the
## other causes.
const _CAUSE_SIZE: int = -1

static var _is_initialized: bool = false
static var _session: RefCounted = null
static var _node: _CORE_NODE = null
static var _root: String = ""
## Folder set by `LocalDataCoreDev.set_test_storage_root`. Empty: the app storage root.
static var _test_storage_root: String = ""
## Core test only: the atomic write step (3 or 4) that fails as if its file system call failed. 0: none. A step 3
## failure after step 2 and a step 4 failure alone cannot be made with files.
static var _failing_write_step: int = 0
## Core test only: bytes left on the device for atomic write step 1. A write of more bytes fails at step 1 as if the
## device were full: at making the missing folder, or else at storing the `.tmp` bytes. -1: the real space left.
static var _test_space_left: int = -1
static var _write_interval_ms: int = 0
static var _file_max_bytes: int = 0
static var _device: _FILE_STATE = _FILE_STATE.new()
static var _user: _FILE_STATE = _FILE_STATE.new()
## True while the write wait runs. It started at real elapsed time `_wait_started_at`.
static var _waiting: bool = false
static var _wait_started_at: int = 0
## Session of the deferred write the frame check queued. `null`: none queued.
static var _deferred_session: RefCounted = null
static var _deferred_write: Callable = Callable()
## Keys with a malformed-key error log, and `<file kind>:<key>` with a type mismatch warn log, since `init`.
static var _bad_key_logged: Dictionary[String, bool] = {}
static var _type_mismatch_logged: Dictionary[String, bool] = {}


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init of an initialized module")
		return false
	var interval: int = _read_setting(_SETTING_WRITE_INTERVAL)
	var max_bytes: int = _read_setting(_SETTING_FILE_MAX_BYTES)
	if interval < 0 or max_bytes < 1:
		return false
	var node: _CORE_NODE = _CORE_NODE.new()
	node.name = "LocalDataCore"
	node.set_process(false)
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	if not EventCore.subscribe(AppBackgroundEnteredEvent, node._on_app_background_entered):
		LogCore.log_error(_TAG, "init could not subscribe to AppBackgroundEnteredEvent")
		node.get_parent().remove_child(node)
		node.free()
		return false
	_write_interval_ms = interval
	_file_max_bytes = max_bytes
	if _test_storage_root.is_empty():
		_root = CoreBuildInfo.storage_root
	else:
		_root = "user://" + _test_storage_root + "/"
	_node = node
	_session = RefCounted.new()
	_deferred_write = node._on_deferred_write
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		_test_storage_root = ""
		_failing_write_step = 0
		_test_space_left = -1
		return
	_write_dirty_files()
	var node: _CORE_NODE = _node
	EventCore.unsubscribe_all(node)
	_reset_state()
	if is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Loads the `device` file. `false` when the load failed; the file kind is loaded either way.
static func load_device_file() -> bool:
	if not _check_initialized("load_device_file"):
		return false
	if _device.loaded:
		LogCore.log_error(_TAG, "load_device_file of a loaded file kind")
		return false
	return _load(_device, _DEVICE_FILE)


## Loads the `user` file of `user_id`. `false` when the load failed; the file kind is loaded either way.
static func load_user_file(user_id: int) -> bool:
	if not _check_initialized("load_user_file"):
		return false
	if _user.loaded:
		LogCore.log_error(_TAG, "load_user_file of a loaded file kind")
		return false
	if user_id <= 0:
		LogCore.log_error(_TAG, "load_user_file got a user ID of 0 or less")
		return false
	var user_hash: String = UtilCore.sha256_hex(str(user_id).to_ascii_buffer())
	return _load(_user, _LOCAL_DATA_FOLDER + "user_" + user_hash.substr(0, 16) + ".dat")


static func is_loaded(kind: FileKind) -> bool:
	if not _is_initialized or not _is_file_kind(kind):
		return false
	return _file_of(kind).loaded


static func get_value_int(kind: FileKind, key: String, default_value: int) -> int:
	var entry: _ENTRY = _read_entry(kind, key, _TYPE_INT)
	return default_value if entry == null else entry.int_value


static func get_value_float(kind: FileKind, key: String, default_value: float) -> float:
	var entry: _ENTRY = _read_entry(kind, key, _TYPE_FLOAT)
	return default_value if entry == null else entry.float_value


static func get_value_bool(kind: FileKind, key: String, default_value: bool) -> bool:
	var entry: _ENTRY = _read_entry(kind, key, _TYPE_BOOL)
	return default_value if entry == null else entry.bool_value


static func get_value_string(kind: FileKind, key: String, default_value: String) -> String:
	var entry: _ENTRY = _read_entry(kind, key, _TYPE_STRING)
	return default_value if entry == null else entry.string_value


static func get_array_int(kind: FileKind, key: String) -> PackedInt64Array:
	var entry: _ENTRY = _read_entry(kind, key, _TYPE_INT_ARRAY)
	return PackedInt64Array() if entry == null else entry.int_array.duplicate()


static func get_array_float(kind: FileKind, key: String) -> PackedFloat64Array:
	var entry: _ENTRY = _read_entry(kind, key, _TYPE_FLOAT_ARRAY)
	return PackedFloat64Array() if entry == null else entry.float_array.duplicate()


static func get_array_bool(kind: FileKind, key: String) -> Array[bool]:
	var entry: _ENTRY = _read_entry(kind, key, _TYPE_BOOL_ARRAY)
	var copy: Array[bool] = []
	if entry != null:
		copy.assign(entry.bool_array)
	return copy


static func get_array_string(kind: FileKind, key: String) -> PackedStringArray:
	var entry: _ENTRY = _read_entry(kind, key, _TYPE_STRING_ARRAY)
	return PackedStringArray() if entry == null else entry.string_array.duplicate()


static func set_value_int(kind: FileKind, key: String, value: int) -> void:
	var entry: _ENTRY = _ENTRY.new()
	entry.value_type = _TYPE_INT
	entry.int_value = value
	_write_entry(kind, key, entry)


static func set_value_float(kind: FileKind, key: String, value: float) -> void:
	var entry: _ENTRY = _ENTRY.new()
	entry.value_type = _TYPE_FLOAT
	entry.float_value = value
	_write_entry(kind, key, entry)


static func set_value_bool(kind: FileKind, key: String, value: bool) -> void:
	var entry: _ENTRY = _ENTRY.new()
	entry.value_type = _TYPE_BOOL
	entry.bool_value = value
	_write_entry(kind, key, entry)


static func set_value_string(kind: FileKind, key: String, value: String) -> void:
	var entry: _ENTRY = _ENTRY.new()
	entry.value_type = _TYPE_STRING
	entry.string_value = value
	_write_entry(kind, key, entry)


static func set_array_int(kind: FileKind, key: String, value: PackedInt64Array) -> void:
	var entry: _ENTRY = _ENTRY.new()
	entry.value_type = _TYPE_INT_ARRAY
	entry.int_array = value.duplicate()
	_write_entry(kind, key, entry)


static func set_array_float(kind: FileKind, key: String, value: PackedFloat64Array) -> void:
	var entry: _ENTRY = _ENTRY.new()
	entry.value_type = _TYPE_FLOAT_ARRAY
	entry.float_array = value.duplicate()
	_write_entry(kind, key, entry)


static func set_array_bool(kind: FileKind, key: String, value: Array[bool]) -> void:
	var entry: _ENTRY = _ENTRY.new()
	entry.value_type = _TYPE_BOOL_ARRAY
	entry.bool_array.assign(value)
	_write_entry(kind, key, entry)


static func set_array_string(kind: FileKind, key: String, value: PackedStringArray) -> void:
	var entry: _ENTRY = _ENTRY.new()
	entry.value_type = _TYPE_STRING_ARRAY
	entry.string_array = value.duplicate()
	_write_entry(kind, key, entry)


static func remove_value(kind: FileKind, key: String) -> void:
	var file: _FILE_STATE = _usable_file(kind, key, "remove_value")
	if file == null or not file.entries.has(key):
		return
	file.entries.erase(key)
	_mark_dirty(file)


## Writes every dirty file kind now.
static func flush() -> void:
	if not _check_initialized("flush"):
		return
	_write_dirty_files()


static func read_file(path: String, max_bytes: int) -> FileResult:
	var result: FileResult = FileResult.new()
	if not _check_initialized("read_file"):
		result.error = FileError.FAILED
		return result
	if not _is_valid_path(path):
		result.error = FileError.INVALID_PATH
		return result
	var full: String = _root + path
	if not _restore_backup(full):
		result.error = FileError.FAILED
		return result
	if not FileAccess.file_exists(full):
		result.error = FileError.NOT_FOUND
		return result
	var file: FileAccess = FileAccess.open(full, FileAccess.READ)
	if file == null:
		result.error = _open_failure(FileAccess.get_open_error())
		return result
	var length: int = file.get_length()
	if length > max_bytes:
		file.close()
		result.error = FileError.TOO_LARGE
		return result
	var bytes: PackedByteArray = file.get_buffer(length)
	var read_error: Error = file.get_error()
	file.close()
	if bytes.size() != length or (read_error != OK and read_error != ERR_FILE_EOF):
		result.error = FileError.FAILED
		return result
	result.ok = true
	result.bytes = bytes
	return result


static func write_file(path: String, bytes: PackedByteArray) -> FileResult:
	var result: FileResult = FileResult.new()
	if not _check_initialized("write_file"):
		result.error = FileError.FAILED
		return result
	if not _is_valid_path(path):
		result.error = FileError.INVALID_PATH
		return result
	var full: String = _root + path
	if not _restore_backup(full):
		result.error = FileError.FAILED
		return result
	if DirAccess.dir_exists_absolute(full):
		result.error = FileError.FAILED
		return result
	result.error = _atomic_write(full, bytes)
	result.ok = result.error == FileError.NONE
	return result


## Deletes the file and its backup. Success when neither is there.
static func delete_file(path: String) -> FileResult:
	var result: FileResult = FileResult.new()
	if not _check_initialized("delete_file"):
		result.error = FileError.FAILED
		return result
	if not _is_valid_path(path):
		result.error = FileError.INVALID_PATH
		return result
	var full: String = _root + path
	if not _restore_backup(full):
		result.error = FileError.FAILED
		return result
	var had_file: bool = FileAccess.file_exists(full) or FileAccess.file_exists(full + _BAK_SUFFIX)
	var removed: bool = _remove_file(full) and _remove_file(full + _BAK_SUFFIX)
	if had_file:
		_request_sync()
	if not removed:
		result.error = FileError.FAILED
		return result
	result.ok = true
	return result


static func file_exists(path: String) -> bool:
	if not _check_initialized("file_exists"):
		return false
	if not _is_valid_path(path):
		return false
	var full: String = _root + path
	if not _restore_backup(full):
		return false
	return FileAccess.file_exists(full)


## Byte count of the file. -1 when there is no file or it cannot be read.
static func get_file_size(path: String) -> int:
	if not _check_initialized("get_file_size"):
		return -1
	if not _is_valid_path(path):
		return -1
	var full: String = _root + path
	if not _restore_backup(full) or not FileAccess.file_exists(full):
		return -1
	var file: FileAccess = FileAccess.open(full, FileAccess.READ)
	if file == null:
		return -1
	var length: int = file.get_length()
	file.close()
	return length


## Names of the files right under `folder` in byte order, without folders, `.tmp` and `.bak` files. An empty
## `folder` is the app storage root.
static func list_files(folder: String) -> PackedStringArray:
	var names: PackedStringArray = PackedStringArray()
	if not _check_initialized("list_files"):
		return names
	if not folder.is_empty() and not _is_valid_path(folder):
		return names
	var full_folder: String = _root if folder.is_empty() else _root + folder + "/"
	if not DirAccess.dir_exists_absolute(full_folder):
		return names
	var dir: DirAccess = DirAccess.open(full_folder)
	if dir == null:
		return names
	var found: PackedStringArray = dir.get_files()
	found.sort()
	for name: String in found:
		if name.ends_with(_BAK_SUFFIX):
			var target: String = name.substr(0, name.length() - _BAK_SUFFIX.length())
			if not found.has(target) and not _restore_backup(full_folder + target):
				return PackedStringArray()
	found = dir.get_files()
	for name: String in found:
		if not name.ends_with(_TMP_SUFFIX) and not name.ends_with(_BAK_SUFFIX):
			names.append(name)
	names.sort()
	return names


## SHA-256 of the file in `text`, read in chunks.
static func hash_file(path: String) -> FileResult:
	var result: FileResult = FileResult.new()
	if not _check_initialized("hash_file"):
		result.error = FileError.FAILED
		return result
	if not _is_valid_path(path):
		result.error = FileError.INVALID_PATH
		return result
	var full: String = _root + path
	if not _restore_backup(full):
		result.error = FileError.FAILED
		return result
	if not FileAccess.file_exists(full):
		result.error = FileError.NOT_FOUND
		return result
	var file: FileAccess = FileAccess.open(full, FileAccess.READ)
	if file == null:
		result.error = _open_failure(FileAccess.get_open_error())
		return result
	var context: HashingContext = HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		file.close()
		result.error = FileError.FAILED
		return result
	var left: int = file.get_length()
	while left > 0:
		var chunk: PackedByteArray = file.get_buffer(mini(left, _HASH_CHUNK_BYTES))
		if chunk.is_empty() or context.update(chunk) != OK:
			file.close()
			result.error = FileError.FAILED
			return result
		left -= chunk.size()
	file.close()
	result.ok = true
	result.text = context.finish().hex_encode()
	return result


## Path the engine opens the file with. Empty for an invalid path.
static func resolve_engine_path(path: String) -> String:
	if not _check_initialized("resolve_engine_path"):
		return ""
	if not _is_valid_path(path):
		return ""
	var full: String = _root + path
	if not _restore_backup(full):
		return ""
	return full


static func _check_initialized(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, operation + " before init")
	return false


static func _read_setting(key: String) -> int:
	if not CoreSettings.has_int(key):
		LogCore.log_error(_TAG, "init could not read core settings key " + key)
		return -1
	return CoreSettings.get_int(key)


static func _reset_state() -> void:
	_is_initialized = false
	_session = null
	_node = null
	_root = ""
	_test_storage_root = ""
	_failing_write_step = 0
	_test_space_left = -1
	_write_interval_ms = 0
	_file_max_bytes = 0
	_device = _FILE_STATE.new()
	_user = _FILE_STATE.new()
	_waiting = false
	_wait_started_at = 0
	_deferred_session = null
	_deferred_write = Callable()
	_bad_key_logged = {}
	_type_mismatch_logged = {}


static func _is_file_kind(kind: int) -> bool:
	return kind == FileKind.DEVICE or kind == FileKind.USER


static func _file_of(kind: FileKind) -> _FILE_STATE:
	return _device if kind == FileKind.DEVICE else _user


## Whether `key` is `<owner>.<name>` with a non-empty owner and a snake_case name.
static func _is_valid_key(key: String) -> bool:
	var parts: PackedStringArray = key.split(".")
	return parts.size() == 2 and not parts[0].is_empty() and UtilCore.is_snake_case(parts[1])


## The loaded file of `kind` for a value operation, or `null` after logging why there is none.
static func _usable_file(kind: FileKind, key: String, operation: String) -> _FILE_STATE:
	if not _check_initialized(operation):
		return null
	if not _is_file_kind(kind):
		LogCore.log_error(_TAG, operation + " got a file kind out of range")
		return null
	var file: _FILE_STATE = _file_of(kind)
	if not file.loaded:
		if not file.not_loaded_logged:
			file.not_loaded_logged = true
			LogCore.log_error(_TAG, operation + " of a file kind before its load")
		return null
	if not _is_valid_key(key):
		if not _bad_key_logged.has(key):
			_bad_key_logged[key] = true
			LogCore.log_error(_TAG, operation + " got a malformed key")
		return null
	return file


static func _read_entry(kind: FileKind, key: String, value_type: int) -> _ENTRY:
	var file: _FILE_STATE = _usable_file(kind, key, "get")
	if file == null or not file.entries.has(key):
		return null
	var entry: _ENTRY = file.entries[key]
	if entry.value_type != value_type:
		var logged: String = str(kind) + ":" + key
		if not _type_mismatch_logged.has(logged):
			_type_mismatch_logged[logged] = true
			LogCore.log_warn(_TAG, "get of a key stored with another type: " + key)
		return null
	return entry


static func _write_entry(kind: FileKind, key: String, entry: _ENTRY) -> void:
	var file: _FILE_STATE = _usable_file(kind, key, "set")
	if file == null:
		return
	if file.entries.has(key) and _is_same(file.entries[key], entry):
		return
	file.entries[key] = entry
	_mark_dirty(file)


static func _is_same(a: _ENTRY, b: _ENTRY) -> bool:
	if a.value_type != b.value_type:
		return false
	match a.value_type:
		_TYPE_INT:
			return a.int_value == b.int_value
		_TYPE_FLOAT:
			return _float_bits(a.float_value) == _float_bits(b.float_value)
		_TYPE_BOOL:
			return a.bool_value == b.bool_value
		_TYPE_STRING:
			return a.string_value == b.string_value
		_TYPE_INT_ARRAY:
			return a.int_array == b.int_array
		_TYPE_FLOAT_ARRAY:
			if a.float_array.size() != b.float_array.size():
				return false
			for i in a.float_array.size():
				if _float_bits(a.float_array[i]) != _float_bits(b.float_array[i]):
					return false
			return true
		_TYPE_BOOL_ARRAY:
			return a.bool_array == b.bool_array
		_TYPE_STRING_ARRAY:
			return a.string_array == b.string_array
	return false


static func _float_bits(value: float) -> int:
	var bytes: PackedByteArray = PackedByteArray()
	bytes.resize(8)
	bytes.encode_double(0, value)
	return bytes.decode_s64(0)


static func _mark_dirty(file: _FILE_STATE) -> void:
	file.dirty = true
	_update_wait()


## Starts the write wait when a writable file kind is dirty and no wait runs; stops it when none is dirty.
static func _update_wait() -> void:
	if not _needs_write(_device) and not _needs_write(_user):
		_waiting = false
		if is_instance_valid(_node):
			_node.set_process(false)
		return
	if _waiting:
		return
	_waiting = true
	_wait_started_at = TimeCore.get_real_time() if TimeCore.is_initialized() else 0
	if is_instance_valid(_node):
		_node.set_process(true)


static func _needs_write(file: _FILE_STATE) -> bool:
	return file.dirty and not file.write_protected


## Frame check of the write wait. The write runs as a deferred call: frame code does not do file operations.
static func _on_frame() -> void:
	if not _waiting or _deferred_session != null or not TimeCore.is_initialized():
		return
	if TimeCore.get_real_time() - _wait_started_at < _write_interval_ms:
		return
	_deferred_session = _session
	_deferred_write.call_deferred()


static func _on_write_due() -> void:
	var session: RefCounted = _deferred_session
	_deferred_session = null
	if session == null or session != _session:
		return
	_waiting = false
	_write_dirty_files()


static func _on_app_background_entered() -> void:
	if _is_initialized:
		_write_dirty_files()


## Cleanup when the tree frees the core node outside `release`, such as at app exit: the same as `release`
## without detaching the node.
static func _on_node_exit(node: _CORE_NODE) -> void:
	if not _is_initialized or node != _node:
		return
	_write_dirty_files()
	EventCore.unsubscribe_all(node)
	_reset_state()


static func _write_dirty_files() -> void:
	_write_file_kind(_device, "device")
	_write_file_kind(_user, "user")
	_update_wait()


static func _write_file_kind(file: _FILE_STATE, kind_name: String) -> void:
	if not _needs_write(file):
		return
	var bytes: PackedByteArray = _serialize(file)
	var cause: int = _CAUSE_SIZE
	if bytes.size() <= _file_max_bytes:
		cause = _atomic_write(_root + file.path, bytes)
		if cause == FileError.NONE:
			file.dirty = false
			file.logged_write_failures = {}
			return
	if file.logged_write_failures.has(cause):
		return
	file.logged_write_failures[cause] = true
	var reason: String = "size above LocalDataCore.fileMaxBytes" if cause == _CAUSE_SIZE else _error_name(cause)
	LogCore.log_error(_TAG, "write of the " + kind_name + " file failed: " + reason)


static func _load(file: _FILE_STATE, path: String) -> bool:
	file.loaded = true
	file.path = path
	var full: String = _root + path
	if not _restore_backup(full):
		# `_restore_backup` logged the failure.
		return _load_failed(file, "")
	if not FileAccess.file_exists(full):
		return true
	var handle: FileAccess = FileAccess.open(full, FileAccess.READ)
	if handle == null:
		return _load_failed(file, "local data file could not be opened")
	var length: int = handle.get_length()
	if length > _file_max_bytes:
		handle.close()
		return _load_failed(file, "local data file is larger than LocalDataCore.fileMaxBytes")
	var bytes: PackedByteArray = handle.get_buffer(length)
	handle.close()
	if bytes.size() != length:
		return _load_failed(file, "local data file could not be read")
	var reader: _READER = _READER.new(bytes)
	var version: int = reader.read_u32()
	if reader.failed:
		return _load_failed(file, "local data file has no schema version")
	if version > _SCHEMA_VERSION:
		file.write_protected = true
		LogCore.log_warn(_TAG, "local data file has a higher schema version: " + str(version))
		return false
	var entries: Dictionary[String, _ENTRY] = _parse(reader, version)
	if reader.failed:
		return _load_failed(file, "local data file has a format error")
	file.entries = entries
	if version < _SCHEMA_VERSION:
		_mark_dirty(file)
	return true


## Empty file state, dirty, and an `error` log of `message` unless it is empty.
static func _load_failed(file: _FILE_STATE, message: String) -> bool:
	file.entries = {}
	if not message.is_empty():
		LogCore.log_error(_TAG, message)
	_mark_dirty(file)
	return false


## Entries of a file of schema `version` after its version field. A file of an earlier version is read by its
## converter. Sets `reader.failed` on a format error.
static func _parse(reader: _READER, version: int) -> Dictionary[String, _ENTRY]:
	var entries: Dictionary[String, _ENTRY] = {}
	if version != _SCHEMA_VERSION:
		# No schema version before 1: a lower version is not a local data file.
		reader.failed = true
		return entries
	var count: int = reader.read_u32()
	for i in count:
		var key: String = reader.read_string()
		var entry: _ENTRY = _read_value(reader)
		if reader.failed:
			return entries
		if not _is_valid_key(key) or entries.has(key):
			reader.failed = true
			return entries
		entries[key] = entry
	if reader.remaining() != 0:
		reader.failed = true
	return entries


## Version 1 value: a u8 type tag and the value. Arrays are a u32 count and the elements.
static func _read_value(reader: _READER) -> _ENTRY:
	var entry: _ENTRY = _ENTRY.new()
	entry.value_type = reader.read_u8()
	match entry.value_type:
		_TYPE_INT:
			entry.int_value = reader.read_s64()
		_TYPE_FLOAT:
			entry.float_value = reader.read_double()
		_TYPE_BOOL:
			entry.bool_value = _read_bool(reader)
		_TYPE_STRING:
			entry.string_value = reader.read_string()
		_TYPE_INT_ARRAY:
			var count: int = _read_count(reader, 8)
			for i in count:
				entry.int_array.append(reader.read_s64())
		_TYPE_FLOAT_ARRAY:
			var count: int = _read_count(reader, 8)
			for i in count:
				entry.float_array.append(reader.read_double())
		_TYPE_BOOL_ARRAY:
			var count: int = _read_count(reader, 1)
			for i in count:
				entry.bool_array.append(_read_bool(reader))
		_TYPE_STRING_ARRAY:
			var count: int = _read_count(reader, 4)
			for i in count:
				entry.string_array.append(reader.read_string())
		_:
			reader.failed = true
	return entry


static func _read_bool(reader: _READER) -> bool:
	var value: int = reader.read_u8()
	if value > 1:
		reader.failed = true
	return value == 1


## An array element count that fits the remaining bytes with elements of at least `element_bytes` each.
static func _read_count(reader: _READER, element_bytes: int) -> int:
	var count: int = reader.read_u32()
	if reader.failed or count * element_bytes > reader.remaining():
		reader.failed = true
		return 0
	return count


## Version 1 bytes of the file state: u32 schema version, u32 entry count, then per entry in key byte order a
## u32-length UTF-8 key and the value of `_read_value`. Integers are little-endian.
static func _serialize(file: _FILE_STATE) -> PackedByteArray:
	var buffer: StreamPeerBuffer = StreamPeerBuffer.new()
	buffer.big_endian = false
	buffer.put_u32(_SCHEMA_VERSION)
	var keys: PackedStringArray = PackedStringArray()
	for key: String in file.entries:
		keys.append(key)
	keys.sort()
	buffer.put_u32(keys.size())
	for key: String in keys:
		_put_string(buffer, key)
		var entry: _ENTRY = file.entries[key]
		buffer.put_u8(entry.value_type)
		match entry.value_type:
			_TYPE_INT:
				buffer.put_64(entry.int_value)
			_TYPE_FLOAT:
				buffer.put_double(entry.float_value)
			_TYPE_BOOL:
				buffer.put_u8(1 if entry.bool_value else 0)
			_TYPE_STRING:
				_put_string(buffer, entry.string_value)
			_TYPE_INT_ARRAY:
				buffer.put_u32(entry.int_array.size())
				for value: int in entry.int_array:
					buffer.put_64(value)
			_TYPE_FLOAT_ARRAY:
				buffer.put_u32(entry.float_array.size())
				for value: float in entry.float_array:
					buffer.put_double(value)
			_TYPE_BOOL_ARRAY:
				buffer.put_u32(entry.bool_array.size())
				for value: bool in entry.bool_array:
					buffer.put_u8(1 if value else 0)
			_TYPE_STRING_ARRAY:
				buffer.put_u32(entry.string_array.size())
				for value: String in entry.string_array:
					_put_string(buffer, value)
	return buffer.data_array


static func _put_string(buffer: StreamPeerBuffer, text: String) -> void:
	var bytes: PackedByteArray = text.to_utf8_buffer()
	buffer.put_u32(bytes.size())
	buffer.put_data(bytes)


## Whether `path` is a valid path for a file operation: `[a-z0-9_./-]` only, no leading or trailing `/`, no empty
## segment or segment starting with `.`, not ending with `.tmp` or `.bak`, and not under a reserved folder.
static func _is_valid_path(path: String) -> bool:
	if path.is_empty() or path.begins_with("/") or path.ends_with("/"):
		return false
	if path.ends_with(_TMP_SUFFIX) or path.ends_with(_BAK_SUFFIX):
		return false
	for i in path.length():
		var c: int = path.unicode_at(i)
		var allowed: bool = (c >= 0x61 and c <= 0x7A) or (c >= 0x30 and c <= 0x39) \
				or c == 0x5F or c == 0x2E or c == 0x2F or c == 0x2D
		if not allowed:
			return false
	var segments: PackedStringArray = path.split("/")
	for segment: String in segments:
		if segment.is_empty() or segment.begins_with("."):
			return false
	return not _RESERVED_FOLDERS.has(segments[0])


## Backup restore: when the target file is missing and `<target>.bak` is there, renames the backup to the target.
## `false` after an `error` log when the rename failed.
static func _restore_backup(full: String) -> bool:
	if FileAccess.file_exists(full) or not FileAccess.file_exists(full + _BAK_SUFFIX):
		return true
	if DirAccess.rename_absolute(full + _BAK_SUFFIX, full) == OK:
		_request_sync()
		return true
	LogCore.log_error(_TAG, "backup restore failed")
	return false


## Opens `local_data/.sync` for writing and closes it: the browser runtime syncs the file system to IndexedDB after
## a write-mode file closes, and a delete or a rename alone does not start that sync. A failure is ignored.
static func _request_sync() -> void:
	var full: String = _root + _SYNC_FILE
	var folder: String = full.get_base_dir()
	if not DirAccess.dir_exists_absolute(folder):
		DirAccess.make_dir_recursive_absolute(folder)
	var file: FileAccess = FileAccess.open(full, FileAccess.WRITE)
	if file != null:
		file.close()


## Atomic write: the target ends with either its old or its new contents.
static func _atomic_write(full: String, bytes: PackedByteArray) -> FileError:
	var folder: String = full.get_base_dir()
	if not DirAccess.dir_exists_absolute(folder):
		if _test_space_short(bytes.size()) or DirAccess.make_dir_recursive_absolute(folder) != OK:
			return _write_failure(folder, bytes.size())
	var tmp: String = full + _TMP_SUFFIX
	var bak: String = full + _BAK_SUFFIX
	var file: FileAccess = FileAccess.open(tmp, FileAccess.WRITE)
	if file == null:
		return _write_failure(folder, bytes.size())
	var stored: bool = false
	var store_error: Error = FAILED
	if not _test_space_short(bytes.size()):
		stored = file.store_buffer(bytes)
		store_error = file.get_error()
	file.close()
	if not stored or store_error != OK:
		_remove_file(tmp)
		return _write_failure(folder, bytes.size())
	var had_target: bool = FileAccess.file_exists(full)
	if had_target:
		if not _remove_file(bak) or DirAccess.rename_absolute(full, bak) != OK:
			_remove_file(tmp)
			return FileError.FAILED
	if _failing_write_step == 3 or DirAccess.rename_absolute(tmp, full) != OK:
		if had_target:
			DirAccess.rename_absolute(bak, full)
		_remove_file(tmp)
		return FileError.FAILED
	if _failing_write_step != 4:
		_remove_file(bak)
	return FileError.NONE


## `true` when the core test space left is set and is less than `size`.
static func _test_space_short(size: int) -> bool:
	return _test_space_left >= 0 and size > _test_space_left


## Removes `full` when it is a file. `true` when no file is left.
static func _remove_file(full: String) -> bool:
	if not FileAccess.file_exists(full):
		return true
	return DirAccess.remove_absolute(full) == OK


## `NoSpace` when the nearest existing folder of `folder` and its ancestors has less free space than the bytes to
## write, `Failed` otherwise. `folder` itself is missing when making it failed.
static func _write_failure(folder: String, size: int) -> FileError:
	var existing: String = folder
	while not DirAccess.dir_exists_absolute(existing):
		var parent: String = existing.get_base_dir()
		if parent == existing:
			return FileError.FAILED
		existing = parent
	var dir: DirAccess = DirAccess.open(existing)
	if dir == null:
		return FileError.FAILED
	var space_left: int = dir.get_space_left() if _test_space_left < 0 else _test_space_left
	return FileError.NO_SPACE if space_left < size else FileError.FAILED


static func _open_failure(open_error: Error) -> FileError:
	return FileError.NOT_FOUND if open_error == ERR_FILE_NOT_FOUND else FileError.FAILED


## Element name of a `FileError`.
static func _error_name(error: int) -> String:
	match error:
		FileError.NONE:
			return "None"
		FileError.INVALID_PATH:
			return "InvalidPath"
		FileError.NOT_FOUND:
			return "NotFound"
		FileError.TOO_LARGE:
			return "TooLarge"
		FileError.NO_SPACE:
			return "NoSpace"
	return "Failed"
