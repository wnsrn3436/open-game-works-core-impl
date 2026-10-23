class_name DataCoreTestSupport
extends RefCounted
## Helpers of the DataCore core tests: module setup, log counts, and downloaded data made from the built-in data.

const TAG: String = "DataCore"
const BUILTIN_LOCATION: String = "res://build/data/"
const MAX_BYTES_KEY: String = "DataCore.downloadedFileMaxBytes"
## An `experiment` ID value no core test data row has. Downloaded data made by `write_downloaded` with `extra_row`
## adds a row of it.
const EXTRA_ID: int = 2000000000


## Initializes DataCore and the modules it depends on, in module list order.
static func init_modules() -> bool:
	return LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and DataCore.init()


static func release_modules() -> void:
	DataCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()


## Number of DataCore `error` logs not checked yet. They count as checked.
static func errors() -> int:
	return UnitTestCore.check_logs("error", TAG)


static func set_max_file_bytes(value: int) -> bool:
	return UnitTestCore.set_test_settings(MAX_BYTES_KEY, value)


## File names of the table binaries in the core test data build, sorted.
static func table_names() -> PackedStringArray:
	var names: PackedStringArray = PackedStringArray()
	var dir: DirAccess = DirAccess.open(BUILTIN_LOCATION)
	if dir == null:
		return names
	for name: String in dir.get_files():
		if name.ends_with(".bin") and not name.begins_with("translation_"):
			names.append(name)
	names.sort()
	return names


static func builtin_file_names() -> PackedStringArray:
	var dir: DirAccess = DirAccess.open(BUILTIN_LOCATION)
	if dir == null:
		return PackedStringArray()
	return dir.get_files()


static func table_bytes(name: String) -> PackedByteArray:
	return FileAccess.get_file_as_bytes(BUILTIN_LOCATION + name)


static func builtin_version() -> String:
	return FileAccess.get_file_as_string(BUILTIN_LOCATION + "data_version").trim_suffix("\n")


static func protocol_hash() -> String:
	return builtin_version().left(64)


## A data version with the built-in protocol hash and the SHA-256 of `seed_text` as data hash.
static func other_version(seed_text: String) -> String:
	return protocol_hash() + "-" + UtilCore.sha256_hex(seed_text.to_utf8_buffer())


## `experiment.bin` of the built-in data with one more row of ID value `EXTRA_ID`.
static func extra_row_bytes() -> PackedByteArray:
	var row: PackedByteArray = PackedByteArray([0x08])
	row.append_array(varint(EXTRA_ID))
	var bytes: PackedByteArray = table_bytes("experiment.bin")
	bytes.append(0x0A)
	bytes.append_array(varint(row.size()))
	bytes.append_array(row)
	return bytes


static func varint(value: int) -> PackedByteArray:
	var out: PackedByteArray = PackedByteArray()
	var rest: int = value
	while rest >= 0x80:
		out.append((rest & 0x7F) | 0x80)
		rest = rest >> 7
	out.append(rest)
	return out


## Writes the built-in table binaries to `folder` in app storage and returns them as downloaded data of `version`.
## `replaced` replaces the bytes of a file, `omitted` leaves files out of the list, `unwritten` keeps files in the
## list without writing them, and `wrong_hash` lists files whose SHA-256 is of other bytes.
static func write_downloaded(
	folder: String,
	version: String,
	replaced: Dictionary[String, PackedByteArray],
	omitted: PackedStringArray = PackedStringArray(),
	unwritten: PackedStringArray = PackedStringArray(),
	wrong_hash: PackedStringArray = PackedStringArray(),
) -> DownloadedData:
	var downloaded: DownloadedData = DownloadedData.new()
	downloaded.data_version = version
	for name: String in table_names():
		if omitted.has(name):
			continue
		var bytes: PackedByteArray = replaced[name] if replaced.has(name) else table_bytes(name)
		var path: String = folder + "/" + name
		if not unwritten.has(name):
			LocalDataCore.write_file(path, bytes)
		var hash_bytes: PackedByteArray = bytes
		if wrong_hash.has(name):
			hash_bytes = bytes.duplicate()
			hash_bytes.append(0)
		downloaded.files[path] = UtilCore.sha256_hex(hash_bytes)
	return downloaded


## Downloaded data of a new data version with the extra `experiment` row.
static func write_valid_downloaded(folder: String, seed_text: String) -> DownloadedData:
	var replaced: Dictionary[String, PackedByteArray] = {"experiment.bin": extra_row_bytes()}
	return write_downloaded(folder, other_version(seed_text), replaced)


## Number of rows in a table binary: occurrences of its field 1. -1 when the bytes are not a table binary.
static func count_rows(bytes: PackedByteArray) -> int:
	var count: int = 0
	var at: int = 0
	while at < bytes.size():
		var tag: PackedInt64Array = read_varint(bytes, at)
		if tag[1] < 0:
			return -1
		at = tag[1]
		if tag[0] != 0x0A:
			return -1
		var length: PackedInt64Array = read_varint(bytes, at)
		if length[1] < 0 or length[1] + length[0] > bytes.size():
			return -1
		at = length[1] + length[0]
		count += 1
	return count


## [value, offset after it] of the varint at `at`, or [0, -1] when it is cut.
static func read_varint(bytes: PackedByteArray, at: int) -> PackedInt64Array:
	var value: int = 0
	var shift: int = 0
	var i: int = at
	while i < bytes.size() and shift < 64:
		var b: int = bytes[i]
		value |= (b & 0x7F) << shift
		i += 1
		if b < 0x80:
			return PackedInt64Array([value, i])
		shift += 7
	return PackedInt64Array([0, -1])
