extends "res://core/local_data_core/tests/support/local_data_test_case.gd"
## Loading local data files: the load table, schema versions, operations before the load, `is_loaded`.

## Schema versions before `LocalDataCore._SCHEMA_VERSION`. Each one has a file
## `res://core/local_data_core/tests/resources/device_v<version>.dat` made with that version, and a case in
## `_check_earlier_version_values`.
const EARLIER_VERSIONS: PackedInt32Array = []


func test_load_reads_the_file() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "test.value", 3)
	restart()
	assert_true(LocalDataCore.load_device_file())
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.value", 0), 3)
	assert_false(LocalDataCore._device.dirty)
	assert_eq(warns(), 0)


func test_load_without_a_file_is_empty() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	assert_true(LocalDataCore._device.entries.is_empty())
	assert_false(LocalDataCore._device.dirty)
	assert_false(raw_exists(DEVICE_FILE))
	assert_eq(warns(), 0)


func test_load_of_a_file_above_the_size_limit() -> void:
	assert_true(UnitTestCore.set_test_settings("LocalDataCore.fileMaxBytes", 32))
	var big: PackedByteArray = PackedByteArray()
	big.resize(33)
	write_raw(DEVICE_FILE, big)
	start()
	assert_false(LocalDataCore.load_device_file())
	assert_eq(errors(), 1)
	assert_true(LocalDataCore.is_loaded(DEVICE))
	assert_true(LocalDataCore._device.entries.is_empty())
	assert_true(LocalDataCore._device.dirty)
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.value", 5), 5)


func test_load_with_a_failed_backup_restore() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "test.value", 3)
	LocalDataCore.release()
	rename_raw(DEVICE_FILE, DEVICE_FILE + ".bak")
	block_path(DEVICE_FILE)
	start()
	assert_false(LocalDataCore.load_device_file())
	assert_eq(errors(), 1)
	assert_true(LocalDataCore._device.entries.is_empty())
	assert_true(LocalDataCore._device.dirty)
	unblock_path(DEVICE_FILE)
	LocalDataCore.flush()
	assert_false(LocalDataCore._device.dirty)


func test_load_of_a_file_with_a_format_error() -> void:
	var bytes: PackedByteArray = version_bytes(LocalDataCore._SCHEMA_VERSION)
	bytes.append_array(PackedByteArray([1, 0, 0, 0, 200]))
	write_raw(DEVICE_FILE, bytes)
	start()
	assert_false(LocalDataCore.load_device_file())
	assert_eq(errors(), 1)
	assert_true(LocalDataCore._device.entries.is_empty())
	assert_true(LocalDataCore._device.dirty)


func test_every_format_error_loads_like_the_format_error_row() -> void:
	var cases: Dictionary[String, PackedByteArray] = {
		"empty file": PackedByteArray(),
		"shorter than the schema version": PackedByteArray([1, 0, 0]),
		"no entry count": version_bytes(1),
		"entry past the file end": _file(1, 1, PackedByteArray()),
		"value past the file end": _file(1, 1, _key("t.a") + PackedByteArray([1, 0, 0])),
		"array count past the file end": _file(1, 1, _key("t.a") + PackedByteArray([5, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])),
		"string past the file end": _file(1, 1, _key("t.a") + PackedByteArray([4, 5, 0, 0, 0, 0x61])),
		"schema version 0": _file(0, 0, PackedByteArray()),
		"type tag 0": _file(1, 1, _key("t.a") + PackedByteArray([0, 0])),
		"type tag 9": _file(1, 1, _key("t.a") + PackedByteArray([9, 0])),
		"bool byte 2": _file(1, 1, _key("t.a") + PackedByteArray([3, 2])),
		"bool array byte 2": _file(1, 1, _key("t.a") + PackedByteArray([7, 1, 0, 0, 0, 2])),
		"malformed UTF-8": _file(1, 1, _key("t.a") + PackedByteArray([4, 2, 0, 0, 0, 0xC0, 0x80])),
		"U+0000 in a string": _file(1, 1, _key("t.a") + PackedByteArray([4, 2, 0, 0, 0, 0x61, 0])),
		"malformed UTF-8 key": _file(1, 1, PackedByteArray([3, 0, 0, 0, 0x74, 0x2E, 0xFF, 3, 1])),
		"malformed key": _file(1, 1, _key("t.B") + PackedByteArray([3, 1])),
		"two entries of a key": _file(1, 2, _key("t.a") + PackedByteArray([3, 1]) + _key("t.a") + PackedByteArray([3, 0])),
		"bytes after the last entry": _file(1, 1, _key("t.a") + PackedByteArray([3, 1, 0])),
	}
	for name: String in cases:
		for kind: LocalDataCore.FileKind in [DEVICE, USER]:
			remove_tree(ROOT)
			write_raw(DEVICE_FILE if kind == DEVICE else user_file(5), cases[name])
			start()
			assert_false(_load(kind), name)
			assert_eq(errors(), 1, name)
			assert_eq(warns(), 0, name)
			assert_true(LocalDataCore.is_loaded(kind), name)
			assert_true(LocalDataCore._file_of(kind).entries.is_empty(), name)
			assert_true(LocalDataCore._file_of(kind).dirty, name)
			assert_false(LocalDataCore._file_of(kind).write_protected, name)
			LocalDataCore.release()
	remove_tree(ROOT)
	write_raw(DEVICE_FILE, _file(1, 2, _key("t.b") + PackedByteArray([3, 1]) + _key("t.a") + PackedByteArray([3, 0])))
	start()
	assert_true(LocalDataCore.load_device_file(), "entries out of key order load")
	assert_true(LocalDataCore.get_value_bool(DEVICE, "t.b", false))


func test_load_of_a_file_shorter_than_the_schema_version() -> void:
	write_raw(DEVICE_FILE, PackedByteArray([1, 0]))
	start()
	assert_false(LocalDataCore.load_device_file())
	assert_eq(errors(), 1)
	assert_true(LocalDataCore._device.dirty)


func test_load_of_a_file_with_a_higher_schema_version() -> void:
	var bytes: PackedByteArray = version_bytes(LocalDataCore._SCHEMA_VERSION + 1)
	bytes.append_array(PackedByteArray([9, 8, 7]))
	write_raw(DEVICE_FILE, bytes)
	start()
	assert_false(LocalDataCore.load_device_file())
	assert_eq(warns(), 1)
	assert_true(LocalDataCore._device.entries.is_empty())
	assert_false(LocalDataCore._device.dirty)
	assert_true(LocalDataCore._device.write_protected)
	LocalDataCore.set_value_int(DEVICE, "test.value", 1)
	LocalDataCore.flush()
	assert_eq(read_raw(DEVICE_FILE), bytes)
	LocalDataCore.release()
	assert_eq(read_raw(DEVICE_FILE), bytes, "the file of the higher version stays as it was")


func test_files_of_earlier_schema_versions_load() -> void:
	assert_eq(EARLIER_VERSIONS.size(), LocalDataCore._SCHEMA_VERSION - 1, "one file per earlier schema version")
	for version: int in EARLIER_VERSIONS:
		remove_tree(ROOT)
		var path: String = "res://core/local_data_core/tests/resources/device_v" + str(version) + ".dat"
		write_raw(DEVICE_FILE, FileAccess.get_file_as_bytes(path))
		start()
		assert_true(LocalDataCore.load_device_file())
		assert_true(LocalDataCore._device.dirty)
		_check_earlier_version_values(version)
		LocalDataCore.flush()
		assert_eq(read_raw(DEVICE_FILE).decode_u32(0), LocalDataCore._SCHEMA_VERSION)
		LocalDataCore.release()


func test_operations_before_the_load_do_nothing_and_log_once() -> void:
	start()
	for kind: LocalDataCore.FileKind in [DEVICE, USER]:
		assert_eq(LocalDataCore.get_value_int(kind, "test.value", 4), 4)
		assert_eq(LocalDataCore.get_array_int(kind, "test.values").size(), 0)
		LocalDataCore.set_value_int(kind, "test.value", 1)
		LocalDataCore.remove_value(kind, "test.value")
		assert_eq(errors(), 1, "one error for the file kind")
	LocalDataCore.flush()
	LocalDataCore.release()
	assert_false(raw_exists(DEVICE_FILE))
	assert_true(snapshot().is_empty(), "no file on the device")


func test_is_loaded() -> void:
	for kind: LocalDataCore.FileKind in [DEVICE, USER]:
		remove_tree(ROOT)
		assert_false(LocalDataCore.is_loaded(kind), "before init")
		start()
		assert_false(LocalDataCore.is_loaded(kind), "before the load")
		assert_true(_load(kind))
		assert_true(LocalDataCore.is_loaded(kind))
		LocalDataCore.release()
		assert_false(LocalDataCore.is_loaded(kind), "after release")
		start()
		assert_false(LocalDataCore.is_loaded(kind), "after release and init")
		LocalDataCore.release()
		var path: String = DEVICE_FILE if kind == DEVICE else user_file(5)
		write_raw(path, PackedByteArray([1, 0]))
		start()
		assert_false(_load(kind))
		assert_eq(errors(), 1)
		assert_true(LocalDataCore.is_loaded(kind), "after a load with output false")
		LocalDataCore.release()


func test_load_restores_the_backup() -> void:
	for kind: LocalDataCore.FileKind in [DEVICE, USER]:
		remove_tree(ROOT)
		var path: String = DEVICE_FILE if kind == DEVICE else user_file(5)
		start()
		assert_true(_load(kind))
		LocalDataCore.set_value_string(kind, "test.value", "kept")
		LocalDataCore.release()
		rename_raw(path, path + ".bak")
		start()
		assert_true(_load(kind))
		assert_eq(LocalDataCore.get_value_string(kind, "test.value", ""), "kept")
		assert_true(raw_exists(path))
		assert_false(raw_exists(path + ".bak"))
		LocalDataCore.release()


func test_second_load_and_invalid_user_id_keep_the_file_state() -> void:
	start()
	assert_false(LocalDataCore.load_user_file(0))
	assert_false(LocalDataCore.load_user_file(-3))
	assert_eq(errors(), 2)
	assert_false(LocalDataCore.is_loaded(USER))
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "test.value", 2)
	assert_false(LocalDataCore.load_device_file())
	assert_eq(errors(), 1)
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.value", 0), 2)


func _load(kind: LocalDataCore.FileKind) -> bool:
	return LocalDataCore.load_device_file() if kind == DEVICE else LocalDataCore.load_user_file(5)


## Checks that the loaded `device` file of schema `version` has the values that file was made with.
func _check_earlier_version_values(version: int) -> void:
	fail_test("no expected values for schema version " + str(version))


## Bytes of a local data file of schema `version` with an entry count `count` and `entries`.
func _file(version: int, count: int, entries: PackedByteArray) -> PackedByteArray:
	var bytes: PackedByteArray = version_bytes(version)
	bytes.append_array(version_bytes(count))
	bytes.append_array(entries)
	return bytes


func _key(key: String) -> PackedByteArray:
	var bytes: PackedByteArray = version_bytes(key.to_utf8_buffer().size())
	bytes.append_array(key.to_utf8_buffer())
	return bytes
