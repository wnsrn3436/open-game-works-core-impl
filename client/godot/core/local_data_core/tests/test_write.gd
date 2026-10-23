extends "res://core/local_data_core/tests/support/local_data_test_case.gd"
## Writing local data files: the write wait, immediate writes, write failures and their logs.


func test_dirty_file_kinds_are_written_after_the_write_interval() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	assert_true(LocalDataCore.load_user_file(3))
	var interval: int = LocalDataCore._write_interval_ms
	assert_gt(interval, 1)
	LocalDataCore.set_value_int(DEVICE, "test.value", 1)
	UnitTestCore.advance_clock(interval - 1, false)
	await wait_write()
	assert_false(raw_exists(DEVICE_FILE), "not written before the interval")
	LocalDataCore.set_value_int(USER, "test.value", 2)
	UnitTestCore.advance_clock(1, false)
	await wait_write()
	assert_true(raw_exists(DEVICE_FILE), "written after the interval")
	assert_true(raw_exists(user_file(3)), "user written with device")
	assert_false(LocalDataCore._device.dirty)
	assert_false(LocalDataCore._user.dirty)
	var device_bytes: PackedByteArray = read_raw(DEVICE_FILE)
	LocalDataCore.set_value_int(DEVICE, "test.value", 5)
	UnitTestCore.advance_clock(interval - 1, false)
	await wait_write()
	assert_eq(read_raw(DEVICE_FILE), device_bytes, "file is unchanged before the next interval")
	UnitTestCore.advance_clock(1, false)
	await wait_write()
	restart()
	assert_true(LocalDataCore.load_device_file())
	assert_true(LocalDataCore.load_user_file(3))
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.value", 0), 5)
	assert_eq(LocalDataCore.get_value_int(USER, "test.value", 0), 2)


func test_background_entry_writes_dirty_file_kinds() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "test.value", 1)
	UnitTestCore.advance_clock(1, true)
	assert_true(raw_exists(DEVICE_FILE))
	assert_false(LocalDataCore._device.dirty)


func test_flush_writes_dirty_file_kinds() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	assert_true(LocalDataCore.load_user_file(3))
	LocalDataCore.set_value_int(DEVICE, "test.value", 1)
	LocalDataCore.set_value_int(USER, "test.value", 1)
	LocalDataCore.flush()
	assert_true(raw_exists(DEVICE_FILE))
	assert_true(raw_exists(user_file(3)))
	assert_false(LocalDataCore._device.dirty)
	assert_false(LocalDataCore._user.dirty)


func test_release_writes_dirty_file_kinds() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "test.value", 1)
	LocalDataCore.release()
	assert_true(raw_exists(DEVICE_FILE))


func test_failed_write_keeps_dirty_and_is_written_after_the_next_wait() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "test.value", 1)
	block_path(DEVICE_FILE + ".tmp")
	LocalDataCore.flush()
	assert_eq(errors(), 1)
	assert_true(LocalDataCore._device.dirty)
	assert_false(raw_exists(DEVICE_FILE))
	unblock_path(DEVICE_FILE + ".tmp")
	UnitTestCore.advance_clock(LocalDataCore._write_interval_ms, false)
	await wait_write()
	assert_true(raw_exists(DEVICE_FILE))
	assert_false(LocalDataCore._device.dirty)


func test_failed_wait_write_waits_again() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "test.value", 1)
	block_path(DEVICE_FILE + ".tmp")
	UnitTestCore.advance_clock(LocalDataCore._write_interval_ms, false)
	await wait_write()
	assert_eq(errors(), 1)
	assert_true(LocalDataCore._device.dirty)
	assert_true(LocalDataCore._waiting, "waits again after the failed write")
	unblock_path(DEVICE_FILE + ".tmp")
	UnitTestCore.advance_clock(LocalDataCore._write_interval_ms, false)
	await wait_write()
	assert_true(raw_exists(DEVICE_FILE))


func test_write_failure_logs_once_per_cause() -> void:
	assert_true(UnitTestCore.set_test_settings("LocalDataCore.fileMaxBytes", 64))
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_string(DEVICE, "test.text", "0123456789".repeat(10))
	LocalDataCore.flush()
	LocalDataCore.flush()
	assert_eq(errors(), 1, "size above the limit twice")
	assert_true(LocalDataCore._device.dirty)
	assert_false(raw_exists(DEVICE_FILE))
	LocalDataCore.set_value_string(DEVICE, "test.text", "short")
	block_path(DEVICE_FILE + ".tmp")
	LocalDataCore.flush()
	LocalDataCore.flush()
	assert_eq(errors(), 1, "a write failure of another cause")
	unblock_path(DEVICE_FILE + ".tmp")
	LocalDataCore.flush()
	assert_false(LocalDataCore._device.dirty)
	LocalDataCore.set_value_string(DEVICE, "test.text", "other")
	block_path(DEVICE_FILE + ".tmp")
	LocalDataCore.flush()
	assert_eq(errors(), 1, "the same cause after a successful write")
	unblock_path(DEVICE_FILE + ".tmp")
	LocalDataCore.flush()
	assert_false(LocalDataCore._device.dirty)
