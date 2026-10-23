extends "res://core/local_data_core/tests/support/local_data_test_case.gd"
## File operations: paths, atomic write, backup restore, size limits, hashing.

const EMPTY_SHA256: String = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
## Unix permissions `rw-r--r--`.
const READABLE_PERMISSIONS: int = 0x1A4


func test_invalid_paths_do_not_touch_app_storage() -> void:
	start()
	write_raw("saves/slot.bin", PackedByteArray([1, 2]))
	write_raw("log/log_1.txt", PackedByteArray([3]))
	write_raw(DEVICE_FILE, PackedByteArray([5]))
	var before: PackedStringArray = snapshot()
	var paths: PackedStringArray = PackedStringArray([
		"", "Saves/slot.bin", "saves/slot bin", "saves/slot.bin?", "é.bin", "/saves/slot.bin", "saves/",
		"saves//slot.bin", ".hidden", "saves/.slot", "saves/../slot.bin", "./slot.bin", "slot.tmp", "slot.bak",
		"saves/slot.bin.bak", "log", "local_data", "log/log_1.txt", "log/new.txt", "local_data/device.dat",
		"local_data/other.dat",
	])
	for path: String in paths:
		assert_false(LocalDataCore.file_exists(path), "file_exists " + path)
		var read: FileResult = LocalDataCore.read_file(path, 1024)
		assert_false(read.ok)
		assert_eq(read.error, LocalDataCore.FileError.INVALID_PATH, "read_file " + path)
		var written: FileResult = LocalDataCore.write_file(path, PackedByteArray([9]))
		assert_false(written.ok)
		assert_eq(written.error, LocalDataCore.FileError.INVALID_PATH, "write_file " + path)
		var deleted: FileResult = LocalDataCore.delete_file(path)
		assert_false(deleted.ok)
		assert_eq(deleted.error, LocalDataCore.FileError.INVALID_PATH, "delete_file " + path)
		var hashed: FileResult = LocalDataCore.hash_file(path)
		assert_false(hashed.ok)
		assert_eq(hashed.error, LocalDataCore.FileError.INVALID_PATH, "hash_file " + path)
		assert_eq(LocalDataCore.get_file_size(path), -1, "get_file_size " + path)
		assert_eq(LocalDataCore.resolve_engine_path(path), "", "resolve_engine_path " + path)
		if not path.is_empty():
			assert_eq(LocalDataCore.list_files(path).size(), 0, "list_files " + path)
	assert_eq(snapshot(), before, "app storage is unchanged")


func test_qa_folder_is_not_reserved() -> void:
	start()
	write_raw("qa/state.json", PackedByteArray([4]))
	assert_true(LocalDataCore.file_exists("qa/state.json"))
	assert_eq(LocalDataCore.read_file("qa/state.json", 10).bytes, PackedByteArray([4]))
	assert_true(LocalDataCore.write_file("qa/new.json", PackedByteArray([5])).ok)
	assert_eq(LocalDataCore.list_files("qa"), PackedStringArray(["new.json", "state.json"]))
	assert_true(LocalDataCore.delete_file("qa/state.json").ok)
	assert_false(raw_exists("qa/state.json"))


func test_folder_path_is_no_file() -> void:
	start()
	write_raw("saves/slot/inner.bin", PackedByteArray([1, 2]))
	var before: PackedStringArray = snapshot()
	assert_false(LocalDataCore.file_exists("saves/slot"))
	assert_eq(LocalDataCore.get_file_size("saves/slot"), -1)
	var read: FileResult = LocalDataCore.read_file("saves/slot", 1024)
	assert_false(read.ok)
	assert_eq(read.error, LocalDataCore.FileError.NOT_FOUND)
	var hashed: FileResult = LocalDataCore.hash_file("saves/slot")
	assert_false(hashed.ok)
	assert_eq(hashed.error, LocalDataCore.FileError.NOT_FOUND)
	var deleted: FileResult = LocalDataCore.delete_file("saves/slot")
	assert_true(deleted.ok)
	assert_eq(deleted.error, LocalDataCore.FileError.NONE)
	var written: FileResult = LocalDataCore.write_file("saves/slot", PackedByteArray([9]))
	assert_false(written.ok)
	assert_eq(written.error, LocalDataCore.FileError.FAILED)
	assert_eq(LocalDataCore.list_files("saves").size(), 0, "a folder is not listed")
	assert_eq(snapshot(), before, "the folder and its file are unchanged")
	assert_true(DirAccess.dir_exists_absolute(ROOT + "saves/slot"))


func test_unreadable_file_exists_and_fails_to_read() -> void:
	start()
	write_raw("locked.bin", PackedByteArray([1, 2, 3]))
	var set_error: Error = FileAccess.set_unix_permissions(ROOT + "locked.bin", 0)
	if set_error == ERR_UNAVAILABLE:
		pass_test("the platform has no unix permissions")
		return
	var probe: FileAccess = FileAccess.open(ROOT + "locked.bin", FileAccess.READ)
	if OS.get_name() == "Web" and (set_error != OK or probe != null):
		# The browser runtime file system does not apply permissions.
		if probe != null:
			probe.close()
		pass_test("the browser runtime file system ignores read permissions")
		return
	assert_eq(set_error, OK)
	assert_null(probe, "the file is unreadable")
	if probe != null:
		probe.close()
	assert_true(LocalDataCore.file_exists("locked.bin"))
	var read: FileResult = LocalDataCore.read_file("locked.bin", 1024)
	assert_false(read.ok)
	assert_eq(read.error, LocalDataCore.FileError.FAILED)
	var hashed: FileResult = LocalDataCore.hash_file("locked.bin")
	assert_false(hashed.ok)
	assert_eq(hashed.error, LocalDataCore.FileError.FAILED)
	FileAccess.set_unix_permissions(ROOT + "locked.bin", READABLE_PERMISSIONS)


func test_write_without_space_is_no_space_and_keeps_the_previous_contents() -> void:
	start()
	assert_true(LocalDataCore.write_file("slot.bin", PackedByteArray([1])).ok)
	LocalDataCore._test_space_left = 2
	var written: FileResult = LocalDataCore.write_file("slot.bin", PackedByteArray([2, 3, 4]))
	assert_false(written.ok)
	assert_eq(written.error, LocalDataCore.FileError.NO_SPACE)
	assert_eq(read_raw("slot.bin"), PackedByteArray([1]))
	assert_false(raw_exists("slot.bin.tmp"))
	assert_false(raw_exists("slot.bin.bak"))
	assert_true(LocalDataCore.write_file("slot.bin", PackedByteArray([2, 3])).ok, "bytes that fit the space")
	block_path("slot.bin.tmp")
	written = LocalDataCore.write_file("slot.bin", PackedByteArray([5]))
	assert_eq(written.error, LocalDataCore.FileError.FAILED, "a step 1 failure with enough space")
	unblock_path("slot.bin.tmp")
	LocalDataCore._test_space_left = -1
	assert_eq(read_raw("slot.bin"), PackedByteArray([2, 3]))


func test_write_without_space_into_a_missing_folder_is_no_space() -> void:
	start()
	LocalDataCore._test_space_left = 2
	var written: FileResult = LocalDataCore.write_file("saves/inner/slot.bin", PackedByteArray([2, 3, 4]))
	assert_false(written.ok)
	assert_eq(written.error, LocalDataCore.FileError.NO_SPACE, "space of the nearest existing folder")
	assert_false(DirAccess.dir_exists_absolute(ROOT + "saves"))
	assert_true(LocalDataCore.write_file("saves/inner/slot.bin", PackedByteArray([2, 3])).ok, "bytes that fit the space")
	LocalDataCore._test_space_left = -1
	assert_eq(read_raw("saves/inner/slot.bin"), PackedByteArray([2, 3]))


func test_release_resets_the_test_space_left() -> void:
	start()
	LocalDataCore._test_space_left = 0
	LocalDataCore.release()
	assert_eq(LocalDataCore._test_space_left, -1)
	LocalDataCore._test_space_left = 0
	LocalDataCore.release()
	assert_eq(LocalDataCore._test_space_left, -1, "release before init")


func test_resolve_engine_path_of_a_missing_file() -> void:
	start()
	assert_eq(LocalDataCore.resolve_engine_path("saves/missing.bin"), ROOT + "saves/missing.bin")
	assert_false(raw_exists("saves"))


func test_delete_and_backup_restore_open_the_sync_file() -> void:
	start()
	assert_true(LocalDataCore.delete_file("missing.bin").ok)
	assert_false(raw_exists(SYNC_FILE), "nothing was deleted")
	assert_true(LocalDataCore.write_file("slot.bin", PackedByteArray([1])).ok)
	assert_false(raw_exists(SYNC_FILE), "write_file closes its .tmp file instead")
	assert_true(LocalDataCore.delete_file("slot.bin").ok)
	assert_true(raw_exists(SYNC_FILE), "after delete_file")
	assert_eq(read_raw(SYNC_FILE).size(), 0)
	remove_tree(ROOT)
	write_raw("slot.bin.bak", PackedByteArray([2]))
	assert_true(LocalDataCore.file_exists("slot.bin"))
	assert_true(raw_exists(SYNC_FILE), "after a backup restore")
	remove_tree(ROOT)
	write_raw("only.bin.bak", PackedByteArray([3]))
	assert_true(LocalDataCore.delete_file("only.bin").ok)
	assert_false(raw_exists("only.bin.bak"))
	assert_true(raw_exists(SYNC_FILE), "after deleting the backup alone")


func test_failed_sync_file_open_is_ignored() -> void:
	start()
	write_raw("local_data", PackedByteArray([7]))
	write_raw("slot.bin", PackedByteArray([1]))
	assert_true(LocalDataCore.delete_file("slot.bin").ok)
	assert_false(raw_exists("slot.bin"))
	assert_eq(read_raw("local_data"), PackedByteArray([7]))
	write_raw("other.bin.bak", PackedByteArray([2]))
	assert_eq(LocalDataCore.read_file("other.bin", 10).bytes, PackedByteArray([2]))
	assert_eq(errors(), 0)


func test_list_files_stops_restoring_after_a_failed_backup_restore() -> void:
	start()
	write_raw("saves/a.bin.bak", PackedByteArray([1]))
	write_raw("saves/b.bin.bak", PackedByteArray([2]))
	write_raw("saves/c.bin.bak", PackedByteArray([3]))
	block_path("saves/b.bin")
	assert_eq(LocalDataCore.list_files("saves").size(), 0)
	assert_eq(errors(), 1)
	assert_true(raw_exists("saves/a.bin"), "the restore before the failure stays")
	assert_false(raw_exists("saves/a.bin.bak"))
	assert_true(raw_exists("saves/b.bin.bak"))
	assert_true(raw_exists("saves/c.bin.bak"), "no restore after the failure")
	assert_false(raw_exists("saves/c.bin"))
	unblock_path("saves/b.bin")


func test_written_file_reads_back_without_a_tmp_file() -> void:
	start()
	var bytes: PackedByteArray = PackedByteArray([0, 1, 2, 255])
	var written: FileResult = LocalDataCore.write_file("saves/deep/slot_1.bin", bytes)
	assert_true(written.ok)
	assert_eq(written.error, LocalDataCore.FileError.NONE)
	var read: FileResult = LocalDataCore.read_file("saves/deep/slot_1.bin", 4)
	assert_true(read.ok)
	assert_eq(read.bytes, bytes)
	assert_eq(read.text, "")
	assert_false(raw_exists("saves/deep/slot_1.bin.tmp"))
	assert_true(LocalDataCore.write_file("saves/deep/slot_1.bin", PackedByteArray([7])).ok)
	assert_eq(LocalDataCore.read_file("saves/deep/slot_1.bin", 4).bytes, PackedByteArray([7]))
	assert_false(raw_exists("saves/deep/slot_1.bin.tmp"))
	assert_false(raw_exists("saves/deep/slot_1.bin.bak"))
	assert_eq(LocalDataCore.get_file_size("saves/deep/slot_1.bin"), 1)
	assert_eq(LocalDataCore.resolve_engine_path("saves/deep/slot_1.bin"), ROOT + "saves/deep/slot_1.bin")


func test_failed_tmp_write_keeps_the_previous_contents() -> void:
	start()
	assert_true(LocalDataCore.write_file("slot.bin", PackedByteArray([1])).ok)
	block_path("slot.bin.tmp")
	var written: FileResult = LocalDataCore.write_file("slot.bin", PackedByteArray([2]))
	assert_false(written.ok)
	assert_eq(written.error, LocalDataCore.FileError.FAILED)
	assert_eq(LocalDataCore.read_file("slot.bin", 10).bytes, PackedByteArray([1]))
	unblock_path("slot.bin.tmp")


func test_failed_rename_to_the_backup_keeps_the_previous_contents() -> void:
	start()
	assert_true(LocalDataCore.write_file("slot.bin", PackedByteArray([1])).ok)
	block_path("slot.bin.bak")
	var written: FileResult = LocalDataCore.write_file("slot.bin", PackedByteArray([2]))
	assert_false(written.ok)
	assert_eq(written.error, LocalDataCore.FileError.FAILED)
	assert_eq(read_raw("slot.bin"), PackedByteArray([1]))
	assert_false(raw_exists("slot.bin.tmp"))
	unblock_path("slot.bin.bak")


func test_failed_rename_to_the_target_restores_the_previous_contents() -> void:
	start()
	assert_true(LocalDataCore.write_file("slot.bin", PackedByteArray([1])).ok)
	LocalDataCore._failing_write_step = 3
	var written: FileResult = LocalDataCore.write_file("slot.bin", PackedByteArray([2]))
	LocalDataCore._failing_write_step = 0
	assert_false(written.ok)
	assert_eq(written.error, LocalDataCore.FileError.FAILED)
	assert_eq(read_raw("slot.bin"), PackedByteArray([1]))
	assert_false(raw_exists("slot.bin.tmp"))
	assert_false(raw_exists("slot.bin.bak"))
	block_path("new.bin")
	written = LocalDataCore.write_file("new.bin", PackedByteArray([3]))
	assert_false(written.ok)
	assert_eq(written.error, LocalDataCore.FileError.FAILED)
	assert_false(raw_exists("new.bin.tmp"))
	assert_false(raw_exists("new.bin.bak"))
	unblock_path("new.bin")


func test_failed_backup_delete_alone_is_a_success() -> void:
	start()
	assert_true(LocalDataCore.write_file("slot.bin", PackedByteArray([1])).ok)
	LocalDataCore._failing_write_step = 4
	var written: FileResult = LocalDataCore.write_file("slot.bin", PackedByteArray([2]))
	LocalDataCore._failing_write_step = 0
	assert_true(written.ok)
	assert_eq(written.error, LocalDataCore.FileError.NONE)
	assert_eq(read_raw("slot.bin"), PackedByteArray([2]))
	assert_eq(read_raw("slot.bin.bak"), PackedByteArray([1]))
	assert_false(raw_exists("slot.bin.tmp"))
	assert_eq(LocalDataCore.read_file("slot.bin", 10).bytes, PackedByteArray([2]))
	assert_true(LocalDataCore.write_file("slot.bin", PackedByteArray([3])).ok)
	assert_eq(read_raw("slot.bin"), PackedByteArray([3]))
	assert_false(raw_exists("slot.bin.bak"))


func test_failed_backup_restore_fails_every_operation() -> void:
	start()
	write_raw("slot.bin.bak", PackedByteArray([4, 5]))
	write_raw("other.bin", PackedByteArray([6]))
	block_path("slot.bin")
	assert_false(LocalDataCore.file_exists("slot.bin"))
	assert_eq(errors(), 1, "file_exists")
	var results: Dictionary[String, FileResult] = {
		"read_file": LocalDataCore.read_file("slot.bin", 10),
		"write_file": LocalDataCore.write_file("slot.bin", PackedByteArray([7])),
		"delete_file": LocalDataCore.delete_file("slot.bin"),
		"hash_file": LocalDataCore.hash_file("slot.bin"),
	}
	for operation: String in results:
		assert_false(results[operation].ok, operation)
		assert_eq(results[operation].error, LocalDataCore.FileError.FAILED, operation)
	assert_eq(errors(), results.size(), "read_file, write_file, delete_file, hash_file")
	assert_eq(LocalDataCore.get_file_size("slot.bin"), -1)
	assert_eq(errors(), 1, "get_file_size")
	assert_eq(LocalDataCore.list_files("").size(), 0)
	assert_eq(errors(), 1, "list_files")
	assert_eq(read_raw("slot.bin.bak"), PackedByteArray([4, 5]))
	assert_false(raw_exists("slot.bin.tmp"))
	unblock_path("slot.bin")


func test_backup_without_the_target_counts_as_the_target() -> void:
	start()
	write_raw("slot.bin.bak", PackedByteArray([4, 5]))
	assert_true(LocalDataCore.file_exists("slot.bin"))
	remove_tree(ROOT)
	write_raw("slot.bin.bak", PackedByteArray([4, 5]))
	var read: FileResult = LocalDataCore.read_file("slot.bin", 10)
	assert_true(read.ok)
	assert_eq(read.bytes, PackedByteArray([4, 5]))
	remove_tree(ROOT)
	write_raw("saves/slot.bin.bak", PackedByteArray([4, 5]))
	write_raw("saves/other.bin", PackedByteArray([6]))
	write_raw("saves/other.bin.tmp", PackedByteArray([6]))
	write_raw("saves/inner/file.bin", PackedByteArray([6]))
	assert_eq(LocalDataCore.list_files("saves"), PackedStringArray(["other.bin", "slot.bin"]))
	assert_true(raw_exists("saves/slot.bin"))
	assert_false(raw_exists("saves/slot.bin.bak"))


func test_list_files_order_and_missing_folder() -> void:
	start()
	for name: String in ["b.bin", "a_2.bin", "a-1.bin", "a.bin", "10.bin", "9.bin"]:
		write_raw("saves/" + name, PackedByteArray([1]))
	assert_eq(LocalDataCore.list_files("saves"),
			PackedStringArray(["10.bin", "9.bin", "a-1.bin", "a.bin", "a_2.bin", "b.bin"]))
	assert_eq(LocalDataCore.list_files("missing").size(), 0)
	write_raw("root.bin", PackedByteArray([1]))
	assert_eq(LocalDataCore.list_files(""), PackedStringArray(["root.bin"]))


func test_size_limit_and_missing_file() -> void:
	start()
	var bytes: PackedByteArray = PackedByteArray()
	bytes.resize(10)
	assert_true(LocalDataCore.write_file("slot.bin", bytes).ok)
	var too_large: FileResult = LocalDataCore.read_file("slot.bin", 9)
	assert_false(too_large.ok)
	assert_eq(too_large.error, LocalDataCore.FileError.TOO_LARGE)
	assert_true(too_large.bytes.is_empty())
	assert_true(LocalDataCore.read_file("slot.bin", 10).ok)
	var missing: FileResult = LocalDataCore.read_file("missing.bin", 10)
	assert_false(missing.ok)
	assert_eq(missing.error, LocalDataCore.FileError.NOT_FOUND)
	assert_eq(LocalDataCore.get_file_size("missing.bin"), -1)
	assert_true(LocalDataCore.delete_file("missing.bin").ok)
	assert_false(LocalDataCore.file_exists("missing.bin"))
	assert_eq(LocalDataCore.hash_file("missing.bin").error, LocalDataCore.FileError.NOT_FOUND)


func test_delete_file_removes_the_file_and_its_backup() -> void:
	start()
	write_raw("slot.bin", PackedByteArray([1]))
	write_raw("slot.bin.bak", PackedByteArray([2]))
	assert_true(LocalDataCore.delete_file("slot.bin").ok)
	assert_false(raw_exists("slot.bin"))
	assert_false(raw_exists("slot.bin.bak"))


func test_hash_file() -> void:
	start()
	assert_true(LocalDataCore.write_file("empty.bin", PackedByteArray()).ok)
	var empty: FileResult = LocalDataCore.hash_file("empty.bin")
	assert_true(empty.ok)
	assert_eq(empty.text, EMPTY_SHA256)
	assert_true(empty.bytes.is_empty())
	assert_eq(LocalDataCore._HASH_CHUNK_BYTES, 65536)
	var chunk: int = LocalDataCore._HASH_CHUNK_BYTES
	for size: int in [chunk - 1, chunk, chunk * 2 + 1]:
		var bytes: PackedByteArray = PackedByteArray()
		bytes.resize(size)
		for i in size:
			bytes[i] = (i * 31 + 7) % 256
		assert_true(LocalDataCore.write_file("big.bin", bytes).ok)
		var big: FileResult = LocalDataCore.hash_file("big.bin")
		assert_true(big.ok, str(size))
		assert_eq(big.text, UtilCore.sha256_hex(bytes), str(size))
		assert_true(big.bytes.is_empty())
