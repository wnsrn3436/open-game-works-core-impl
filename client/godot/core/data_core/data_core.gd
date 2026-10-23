class_name DataCore
extends RefCounted
## Loads the built client data from downloaded data or built-in data into the generated containers, and lets content
## code make derived containers in the `build_derived` hook and look them up.

const DataCoreSession := preload("res://core/data_core/data_core_session.gd")
const DataRowList := preload("res://core/data_core/data_row_list.gd")

const _TAG: String = "DataCore"
const _MAX_BYTES_KEY: String = "DataCore.downloadedFileMaxBytes"
## Built-in data location of the build.
const _DEFAULT_LOCATION: String = "res://build/data/"
const _VERSION_FILE: String = "data_version"
const _TABLE_EXTENSION: String = ".bin"
const _TRANSLATION_PREFIX: String = "translation_"
const _HASH_LENGTH: int = 64
## `<protocol hash>-<data hash>`.
const _VERSION_LENGTH: int = 129
const _MAX_KEY_COLUMNS: int = 3
## Returned for a missing key of a `DataGroup`. A constant array is read-only.
const _NO_ROWS: Array[RefCounted] = []

static var _is_initialized: bool = false
static var _session: DataCoreSession = DataCoreSession.new()
## `DataCore.downloadedFileMaxBytes`.
static var _max_file_bytes: int = 0
## True after the first `load` of this `init`, whatever its result.
static var _load_called: bool = false
static var _is_loaded: bool = false
static var _data_version: String = ""
## True once the built-in data version was read. `_builtin_version` stays empty when the read failed.
static var _builtin_version_read: bool = false
static var _builtin_version: String = ""
static var _builtin_location: String = _DEFAULT_LOCATION
static var _build_derived_hook: Callable = Callable()
static var _derived_called: bool = false
## True while the `build_derived` hook runs: the only time `make_index` and `make_group` make containers.
static var _building_derived: bool = false
## True when a `make_index` of this build found a duplicate key.
static var _derived_failed: bool = false
## (container, key) pairs whose missing data was logged.
static var _missing_logged: Dictionary[String, bool] = {}


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init while initialized")
		return false
	if not CoreSettings.has_int(_MAX_BYTES_KEY):
		LogCore.log_error(_TAG, "core settings key %s is missing or not an integer" % _MAX_BYTES_KEY)
		return false
	_max_file_bytes = CoreSettings.get_int(_MAX_BYTES_KEY)
	_session = DataCoreSession.new()
	_is_initialized = true
	return true


static func release() -> void:
	var old: DataCoreSession = _session
	_session = DataCoreSession.new()
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree != null and tree.process_frame.is_connected(old.resume):
		tree.process_frame.disconnect(old.resume)
	old.resume()
	GameData.clear()
	_is_initialized = false
	_max_file_bytes = 0
	_load_called = false
	_is_loaded = false
	_data_version = ""
	_builtin_version_read = false
	_builtin_version = ""
	_builtin_location = _DEFAULT_LOCATION
	_build_derived_hook = Callable()
	_derived_called = false
	_building_derived = false
	_derived_failed = false
	_missing_logged = {}


static func is_initialized() -> bool:
	return _is_initialized


## Loads `downloaded` when it passes every check, and the built-in data otherwise. `downloaded` is `null` when
## there is no downloaded data. Once for each `init`.
static func load(downloaded: DownloadedData = null) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "load before init")
		return false
	if _load_called:
		LogCore.log_error(_TAG, "second load in one init")
		return false
	_load_called = true
	var session: DataCoreSession = _session
	await _wait_frame(session)
	if session != _session:
		return false
	if downloaded != null and _load_downloaded(downloaded):
		_data_version = downloaded.data_version
		_is_loaded = true
		return true
	GameData.clear()
	if _load_builtin():
		_data_version = _builtin_version
		_is_loaded = true
		return true
	GameData.clear()
	return false


static func is_loaded() -> bool:
	return _is_loaded


static func get_data_version() -> String:
	if not _is_loaded:
		LogCore.log_error(_TAG, "get_data_version before a successful load")
		return ""
	return _data_version


static func get_builtin_data_version() -> String:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_builtin_data_version before init")
		return ""
	var version: String = _read_builtin_version()
	if version.is_empty():
		LogCore.log_error(_TAG, "built-in data version at %s is not readable" % _builtin_location)
	return version


static func get_builtin_location() -> String:
	return _builtin_location


## Calls the `build_derived` hook once after a successful `load`, then locks the derived containers.
static func build_derived_containers() -> bool:
	if not _is_loaded:
		LogCore.log_error(_TAG, "build_derived_containers before a successful load")
		return false
	if _derived_called:
		LogCore.log_error(_TAG, "second build_derived_containers")
		return false
	_derived_called = true
	_building_derived = true
	var ok: bool = true
	if not _build_derived_hook.is_null():
		ok = _call_bool_hook(_build_derived_hook)
	_building_derived = false
	return ok and not _derived_failed


## Registers the `build_derived` hook, a static func with no input that returns a success flag. A second
## registration is ignored.
static func register_build_derived(hook: Callable) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "register_build_derived before init")
		return false
	if not hook.is_valid() or not hook.is_standard() or not (hook.get_object() is Script):
		LogCore.log_error(_TAG, "build_derived hook is not a static func")
		return false
	if not _build_derived_hook.is_null():
		LogCore.log_error(_TAG, "second register_build_derived; the later hook is ignored")
		return false
	_build_derived_hook = hook
	return true


## `DataIndex` with one row for each combination of the values of `columns`, the key columns of `table`.
static func make_index(table: String, columns: PackedStringArray) -> DataIndex:
	var index: DataIndex = DataIndex.new()
	index._table = table
	index._key_count = columns.size()
	index._empty_row = GameData.table_empty_row(table)
	if not _can_make("make_index", table, columns):
		return index
	index._session = _session
	var duplicates: Dictionary[PackedInt64Array, bool] = {}
	for row: RefCounted in GameData.table_rows(table):
		var key: PackedInt64Array = _row_key(table, columns, row)
		if index._rows.has(key):
			duplicates[key] = true
		else:
			index._rows[key] = row
	for key: PackedInt64Array in duplicates:
		index._rows.erase(key)
		LogCore.log_error(_TAG, "make_index of table %s: key %s of columns %s is on more than one row" % [table, key, columns])
	if not duplicates.is_empty():
		_derived_failed = true
	return index


## `DataGroup` with a row list in table row order for each combination of the values of `columns`, the key columns
## of `table`.
static func make_group(table: String, columns: PackedStringArray) -> DataGroup:
	var group: DataGroup = DataGroup.new()
	group._table = table
	group._key_count = columns.size()
	if not _can_make("make_group", table, columns):
		return group
	group._session = _session
	for row: RefCounted in GameData.table_rows(table):
		var key: PackedInt64Array = _row_key(table, columns, row)
		var list: DataRowList = group._lists.get(key)
		if list == null:
			list = DataRowList.new()
			group._lists[key] = list
		list.rows.append(row)
	for key: PackedInt64Array in group._lists:
		group._lists[key].rows.make_read_only()
	return group


## The row of `key` in `index`, or the empty row of its table.
static func get_row(index: DataIndex, key: PackedInt64Array) -> RefCounted:
	if index == null:
		LogCore.log_error(_TAG, "get_row of a null DataIndex")
		return null
	if key.size() != index._key_count:
		LogCore.log_error(_TAG, "get_row of table %s: %d key values for %d key columns" % [index._table, key.size(), index._key_count])
		return index._empty_row
	if index._session == _session and index._rows.has(key):
		return index._rows[key]
	_log_missing("get_row", index, index._table, key)
	return index._empty_row


static func has_row(index: DataIndex, key: PackedInt64Array) -> bool:
	if index == null:
		LogCore.log_error(_TAG, "has_row of a null DataIndex")
		return false
	if key.size() != index._key_count:
		LogCore.log_error(_TAG, "has_row of table %s: %d key values for %d key columns" % [index._table, key.size(), index._key_count])
		return false
	return index._session == _session and index._rows.has(key)


## The read-only row list of `key` in `group`, or an empty list.
static func get_rows(group: DataGroup, key: PackedInt64Array) -> Array[RefCounted]:
	if group == null:
		LogCore.log_error(_TAG, "get_rows of a null DataGroup")
		return _NO_ROWS
	if key.size() != group._key_count:
		LogCore.log_error(_TAG, "get_rows of table %s: %d key values for %d key columns" % [group._table, key.size(), group._key_count])
		return _NO_ROWS
	if group._session == _session and group._lists.has(key):
		return group._lists[key].rows
	_log_missing("get_rows", group, group._table, key)
	return _NO_ROWS


static func has_rows(group: DataGroup, key: PackedInt64Array) -> bool:
	if group == null:
		LogCore.log_error(_TAG, "has_rows of a null DataGroup")
		return false
	if key.size() != group._key_count:
		LogCore.log_error(_TAG, "has_rows of table %s: %d key values for %d key columns" % [group._table, key.size(), group._key_count])
		return false
	return group._session == _session and group._lists.has(key)


## Waits one frame, or until `release` resumes `session`.
static func _wait_frame(session: DataCoreSession) -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		return
	if tree.process_frame.connect(session.resume, CONNECT_ONE_SHOT) != OK:
		return
	await session.resumed


## Checks 1 to 6 of the downloaded data, and on success leaves its tables in the containers.
static func _load_downloaded(downloaded: DownloadedData) -> bool:
	var version: String = downloaded.data_version
	if not _is_data_version(version):
		return false
	var builtin_version: String = _read_builtin_version()
	if builtin_version.is_empty() or version.left(_HASH_LENGTH) != builtin_version.left(_HASH_LENGTH):
		return false
	var names: PackedStringArray = PackedStringArray()
	for path: String in downloaded.files:
		names.append(path.get_file())
	names.sort()
	if names != _builtin_table_names():
		LogCore.log_error(_TAG, "downloaded data files %s are not the built-in table binaries" % names)
		return false
	for path: String in downloaded.files:
		var size: int = LocalDataCore.get_file_size(path)
		if size < 0:
			LogCore.log_error(_TAG, "downloaded data file %s is not readable" % path)
			return false
		if size > _max_file_bytes:
			LogCore.log_error(_TAG, "downloaded data file %s has %d bytes, more than %d" % [path, size, _max_file_bytes])
			return false
	var files: Dictionary[String, PackedByteArray] = {}
	for path: String in downloaded.files:
		var result: FileResult = LocalDataCore.read_file(path, _max_file_bytes)
		if not result.ok:
			LogCore.log_error(_TAG, "downloaded data file %s is not readable" % path)
			return false
		if UtilCore.sha256_hex(result.bytes) != downloaded.files[path]:
			LogCore.log_error(_TAG, "downloaded data file %s does not match its SHA-256" % path)
			return false
		files[path.get_file()] = result.bytes
	if not GameData.load_tables(files):
		LogCore.log_error(_TAG, "downloaded data %s does not decode" % version)
		return false
	return true


static func _load_builtin() -> bool:
	if _read_builtin_version().is_empty():
		LogCore.log_error(_TAG, "built-in data version at %s is not readable" % _builtin_location)
		return false
	var files: Dictionary[String, PackedByteArray] = {}
	for name: String in _builtin_table_names():
		var bytes: PackedByteArray = FileAccess.get_file_as_bytes(_builtin_location + name)
		if FileAccess.get_open_error() != OK:
			LogCore.log_error(_TAG, "built-in data file %s%s is not readable" % [_builtin_location, name])
			return false
		files[name] = bytes
	if not GameData.load_tables(files):
		LogCore.log_error(_TAG, "built-in data at %s does not load" % _builtin_location)
		return false
	return true


## The built-in data version, read once until `release`. Empty when it is not readable.
static func _read_builtin_version() -> String:
	if _builtin_version_read:
		return _builtin_version
	_builtin_version_read = true
	var text: String = FileAccess.get_file_as_string(_builtin_location + _VERSION_FILE)
	if FileAccess.get_open_error() != OK:
		return ""
	text = text.trim_suffix("\n")
	if _is_data_version(text):
		_builtin_version = text
	return _builtin_version


## File names of the built-in table binaries, sorted. Translation binaries and `data_version` are not in it.
static func _builtin_table_names() -> PackedStringArray:
	var names: PackedStringArray = PackedStringArray()
	var dir: DirAccess = DirAccess.open(_builtin_location)
	if dir == null:
		return names
	for name: String in dir.get_files():
		if name.ends_with(_TABLE_EXTENSION) and not name.begins_with(_TRANSLATION_PREFIX):
			names.append(name)
	names.sort()
	return names


## True for `<protocol hash>-<data hash>`: two SHA-256 lowercase hex joined by one `-`.
static func _is_data_version(text: String) -> bool:
	if text.length() != _VERSION_LENGTH:
		return false
	for i: int in _VERSION_LENGTH:
		var c: int = text.unicode_at(i)
		if i == _HASH_LENGTH:
			if c != 0x2D:
				return false
		elif not ((c >= 0x30 and c <= 0x39) or (c >= 0x61 and c <= 0x66)):
			return false
	return true


## True when the calling `make_index` or `make_group` may make a container of `columns` of `table`.
static func _can_make(operation: String, table: String, columns: PackedStringArray) -> bool:
	if not _building_derived:
		LogCore.log_error(_TAG, "%s of table %s outside the build_derived hook" % [operation, table])
		return false
	if columns.size() < 1 or columns.size() > _MAX_KEY_COLUMNS:
		LogCore.log_error(_TAG, "%s of table %s: %d key columns" % [operation, table, columns.size()])
		return false
	if GameData.table_empty_row(table) == null:
		LogCore.log_error(_TAG, "%s: no table %s" % [operation, table])
		return false
	for column: String in columns:
		if not GameData.is_key_column(table, column):
			LogCore.log_error(_TAG, "%s of table %s: %s is not a key column" % [operation, table, column])
			return false
	return true


## Key value of `row`: the values of `columns` in order.
static func _row_key(table: String, columns: PackedStringArray, row: RefCounted) -> PackedInt64Array:
	var key: PackedInt64Array = PackedInt64Array()
	key.resize(columns.size())
	for i: int in columns.size():
		key[i] = GameData.key_value(table, columns[i], row)
	return key


## Logs missing data of `key` in `container` once until `release`.
static func _log_missing(operation: String, container: RefCounted, table: String, key: PackedInt64Array) -> void:
	var record: String = "%d %s" % [container.get_instance_id(), key]
	if _missing_logged.has(record):
		return
	_missing_logged[record] = true
	LogCore.log_error(_TAG, "%s of table %s: missing data for key %s" % [operation, table, key])


# ogw:input_boundary
static func _call_bool_hook(hook: Callable) -> bool:
	var mark: int = CoreScriptErrors.begin()
	var result: Variant = hook.call()
	if CoreScriptErrors.end(mark):
		LogCore.log_error(_TAG, "build_derived hook threw")
		return false
	if not result is bool:
		LogCore.log_error(_TAG, "build_derived hook did not return a bool")
		return false
	var ok: bool = result
	return ok
