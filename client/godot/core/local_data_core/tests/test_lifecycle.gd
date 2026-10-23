extends "res://core/local_data_core/tests/support/local_data_test_case.gd"
## `init`, `release`, the core node and the test storage root.


func test_init_and_release() -> void:
	assert_false(LocalDataCore.is_initialized())
	start()
	assert_true(LocalDataCore.is_initialized())
	var node: Node = LocalDataCore._node
	assert_true(node.is_inside_tree())
	assert_true(LocalDataCore.load_device_file())
	assert_true(LocalDataCore.load_user_file(9))
	LocalDataCore.set_value_int(DEVICE, "test.value", 1)
	LocalDataCore.get_value_string(DEVICE, "test.value", "")
	LocalDataCore.get_value_int(DEVICE, "bad", 0)
	assert_eq(errors(), 1)
	assert_eq(warns(), 1)
	var device: RefCounted = LocalDataCore._device
	var user: RefCounted = LocalDataCore._user
	LocalDataCore.release()
	assert_false(LocalDataCore.is_initialized())
	assert_false(is_instance_valid(node) and node.is_inside_tree(), "core node left the tree")
	assert_eq(LocalDataCore._session, null)
	assert_eq(LocalDataCore._node, null)
	assert_eq(LocalDataCore._root, "")
	assert_eq(LocalDataCore._test_storage_root, "")
	assert_eq(LocalDataCore._write_interval_ms, 0)
	assert_eq(LocalDataCore._file_max_bytes, 0)
	assert_false(LocalDataCore._waiting)
	assert_eq(LocalDataCore._wait_started_at, 0)
	assert_eq(LocalDataCore._deferred_session, null)
	assert_false(LocalDataCore._deferred_write.is_valid())
	assert_true(LocalDataCore._bad_key_logged.is_empty())
	assert_true(LocalDataCore._type_mismatch_logged.is_empty())
	assert_ne(LocalDataCore._device, device)
	assert_ne(LocalDataCore._user, user)
	for file: LocalDataCore._FILE_STATE in [LocalDataCore._device, LocalDataCore._user]:
		assert_true(file.entries.is_empty())
		assert_false(file.loaded)
		assert_false(file.dirty)
		assert_false(file.write_protected)
		assert_eq(file.path, "")
		assert_false(file.not_loaded_logged)
		assert_true(file.logged_write_failures.is_empty())
	start()
	assert_true(LocalDataCore.load_device_file())
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.value", 0), 1, "init after release works as the first init")
	LocalDataCore.get_value_int(DEVICE, "bad", 0)
	assert_eq(errors(), 1, "the key error logs again after release")


func test_init_of_an_initialized_module_fails() -> void:
	start()
	assert_false(LocalDataCore.init())
	assert_eq(errors(), 1)
	assert_true(LocalDataCore.is_initialized())


func test_operations_before_init_fail() -> void:
	assert_false(LocalDataCore.load_device_file())
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.value", 6), 6)
	assert_eq(LocalDataCore.read_file("slot.bin", 1).error, LocalDataCore.FileError.FAILED)
	assert_eq(LocalDataCore.list_files("").size(), 0)
	assert_eq(errors(), 4)
	LocalDataCore.release()


func test_core_node_freed_by_the_tree_cleans_up_like_release() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "test.value", 1)
	var node: Node = LocalDataCore._node
	node.free()
	assert_false(LocalDataCore.is_initialized())
	assert_eq(LocalDataCore._node, null)
	assert_true(raw_exists(DEVICE_FILE), "dirty file kinds are written")
	start()
	assert_true(LocalDataCore.load_device_file())
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.value", 0), 1)


func test_test_storage_root() -> void:
	start()
	assert_eq(LocalDataCore._root, ROOT)
	assert_true(LocalDataCore.write_file("slot.bin", PackedByteArray([1])).ok)
	assert_true(FileAccess.file_exists(ROOT + "slot.bin"))
	LocalDataCoreDev.set_test_storage_root("other")
	assert_eq(errors(), 1, "set_test_storage_root after init")
	assert_eq(LocalDataCore._root, ROOT)
	LocalDataCore.release()
	assert_eq(LocalDataCore._test_storage_root, "")


func test_invalid_test_storage_root_is_ignored() -> void:
	for folder: String in ["", "Other", "/other", "other/", "a//b", ".other", "other.tmp", "log", "local_data/x"]:
		LocalDataCoreDev.set_test_storage_root(TEST_FOLDER)
		LocalDataCoreDev.set_test_storage_root(folder)
		assert_eq(errors(), 1, "invalid folder " + folder)
		assert_eq(LocalDataCore._test_storage_root, TEST_FOLDER, folder)
		LocalDataCore.release()
	LocalDataCoreDev.set_test_storage_root("log")
	assert_eq(errors(), 1)
	assert_true(LocalDataCore.init())
	assert_eq(LocalDataCore._root, CoreBuildInfo.storage_root, "the app storage root stays the base folder")
	LocalDataCore.release()


func test_missing_test_storage_root_is_made_by_the_first_write() -> void:
	assert_false(DirAccess.dir_exists_absolute(ROOT + "nested"))
	LocalDataCoreDev.set_test_storage_root(TEST_FOLDER + "/nested/root")
	assert_true(LocalDataCore.init())
	assert_eq(LocalDataCore._root, ROOT + "nested/root/")
	assert_false(LocalDataCore.file_exists("slot.bin"))
	assert_true(LocalDataCore.write_file("slot.bin", PackedByteArray([1])).ok)
	assert_eq(FileAccess.get_file_as_bytes(ROOT + "nested/root/slot.bin"), PackedByteArray([1]))
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "test.value", 1)
	LocalDataCore.flush()
	assert_true(FileAccess.file_exists(ROOT + "nested/root/" + DEVICE_FILE))


func test_release_resets_the_failing_write_step() -> void:
	start()
	LocalDataCore._failing_write_step = 3
	LocalDataCore.release()
	assert_eq(LocalDataCore._failing_write_step, 0)
	start()
	assert_true(LocalDataCore.write_file("slot.bin", PackedByteArray([1])).ok, "the next write after release is not failed")
	assert_false(raw_exists("slot.bin.bak"))


func test_release_before_init_resets_the_failing_write_step() -> void:
	LocalDataCore._failing_write_step = 4
	LocalDataCore.release()
	assert_eq(LocalDataCore._failing_write_step, 0)
