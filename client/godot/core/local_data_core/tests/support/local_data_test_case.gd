extends UnitTestCase
## Setup and raw file helpers of the `LocalDataCore` core tests. Every test works in the test storage root
## `ROOT`, which each test starts empty.

const TEST_FOLDER: String = "local_data_core_test"
const ROOT: String = "user://local_data_core_test/"
const TAG: String = "LocalDataCore"
const DEVICE: LocalDataCore.FileKind = LocalDataCore.FileKind.DEVICE
const USER: LocalDataCore.FileKind = LocalDataCore.FileKind.USER
const DEVICE_FILE: String = "local_data/device.dat"
## File a deleting or renaming file operation opens for writing to start the browser runtime sync.
const SYNC_FILE: String = "local_data/.sync"
## Bits of float64 `-0.0`: only the sign bit.
const NEGATIVE_ZERO_BITS: int = -9223372036854775808


func before_each() -> void:
	super()
	if LocalDataCore.is_initialized():
		LocalDataCore.release()
	remove_tree(ROOT)
	if not LogCore.is_initialized():
		assert_true(LogCore.init(), "LogCore init")
	if not EventCore.is_initialized():
		assert_true(EventCore.init(), "EventCore init")
	if not TimeCore.is_initialized():
		assert_true(TimeCore.init(), "TimeCore init")


## Inits `LocalDataCore` in the test storage root.
func start() -> void:
	LocalDataCoreDev.set_test_storage_root(TEST_FOLDER)
	assert_true(LocalDataCore.init(), "LocalDataCore init")


func restart() -> void:
	LocalDataCore.release()
	start()


func errors() -> int:
	return UnitTestCore.check_logs("error", TAG)


func warns() -> int:
	return UnitTestCore.check_logs("warn", TAG)


## Engine frames for the frame check of the write wait and the deferred write it queues.
func wait_write() -> void:
	await UnitTestCore.wait_frames(2)


func user_file(user_id: int) -> String:
	return "local_data/user_" + UtilCore.sha256_hex(str(user_id).to_ascii_buffer()).substr(0, 16) + ".dat"


func write_raw(path: String, bytes: PackedByteArray) -> void:
	var full: String = ROOT + path
	assert_eq(DirAccess.make_dir_recursive_absolute(full.get_base_dir()), OK, "make folder of " + path)
	var file: FileAccess = FileAccess.open(full, FileAccess.WRITE)
	assert_not_null(file, "open " + path)
	if file != null:
		file.store_buffer(bytes)
		file.close()


func read_raw(path: String) -> PackedByteArray:
	return FileAccess.get_file_as_bytes(ROOT + path)


func raw_exists(path: String) -> bool:
	return FileAccess.file_exists(ROOT + path)


func rename_raw(from: String, to: String) -> void:
	assert_eq(DirAccess.rename_absolute(ROOT + from, ROOT + to), OK, "rename " + from)


## A folder at `path` with one file in it, so that neither a file write nor a rename can take that path.
func block_path(path: String) -> void:
	write_raw(path + "/block", PackedByteArray([1]))


func unblock_path(path: String) -> void:
	remove_tree(ROOT + path + "/")


## Every file under the test storage root as `<path>:<SHA-256>`, sorted.
func snapshot() -> PackedStringArray:
	var lines: PackedStringArray = PackedStringArray()
	_collect(ROOT, "", lines)
	lines.sort()
	return lines


func remove_tree(folder: String) -> void:
	var dir: DirAccess = DirAccess.open(folder)
	if dir == null:
		return
	dir.include_hidden = true
	for name: String in dir.get_directories():
		remove_tree(folder + name + "/")
	for name: String in dir.get_files():
		DirAccess.remove_absolute(folder + name)
	DirAccess.remove_absolute(folder)


## Float64 `-0.0`, made at run time: GDScript keeps one constant for the equal literals `-0.0` and `0.0`.
func negative_zero() -> float:
	var bytes: PackedByteArray = PackedByteArray()
	bytes.resize(8)
	bytes.encode_s64(0, NEGATIVE_ZERO_BITS)
	return bytes.decode_double(0)


## Bytes of a schema version field.
func version_bytes(version: int) -> PackedByteArray:
	var bytes: PackedByteArray = PackedByteArray()
	bytes.resize(4)
	bytes.encode_u32(0, version)
	return bytes


func _collect(folder: String, prefix: String, lines: PackedStringArray) -> void:
	var dir: DirAccess = DirAccess.open(folder)
	if dir == null:
		return
	dir.include_hidden = true
	for name: String in dir.get_directories():
		_collect(folder + name + "/", prefix + name + "/", lines)
	for name: String in dir.get_files():
		lines.append(prefix + name + ":" + UtilCore.sha256_hex(FileAccess.get_file_as_bytes(folder + name)))
