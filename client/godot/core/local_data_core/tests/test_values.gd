extends "res://core/local_data_core/tests/support/local_data_test_case.gd"
## Local data values: types, defaults, keys, copies, user files and file bytes.


func test_values_survive_release_init_and_load() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	assert_true(LocalDataCore.load_user_file(7))
	for kind: LocalDataCore.FileKind in [DEVICE, USER]:
		LocalDataCore.set_value_int(kind, "test.int_max", 9223372036854775807)
		LocalDataCore.set_value_int(kind, "test.int_min", -9223372036854775808)
		LocalDataCore.set_value_float(kind, "test.negative_zero", negative_zero())
		LocalDataCore.set_value_float(kind, "test.fraction", 0.1)
		LocalDataCore.set_value_bool(kind, "test.yes", true)
		LocalDataCore.set_value_bool(kind, "test.no", false)
		LocalDataCore.set_value_string(kind, "test.empty", "")
		LocalDataCore.set_value_string(kind, "test.non_ascii", "한글 ünïcödé 日本 🎮")
		LocalDataCore.set_array_int(kind, "test.ints", PackedInt64Array([1, -2, 9223372036854775807]))
		LocalDataCore.set_array_float(kind, "test.floats", PackedFloat64Array([negative_zero(), 2.5]))
		var bools: Array[bool] = [true, false]
		LocalDataCore.set_array_bool(kind, "test.bools", bools)
		LocalDataCore.set_array_string(kind, "test.strings", PackedStringArray(["", "ß", "😀"]))
		var no_bools: Array[bool] = []
		LocalDataCore.set_array_int(kind, "test.no_ints", PackedInt64Array())
		LocalDataCore.set_array_float(kind, "test.no_floats", PackedFloat64Array())
		LocalDataCore.set_array_bool(kind, "test.no_bools", no_bools)
		LocalDataCore.set_array_string(kind, "test.no_strings", PackedStringArray())
	restart()
	assert_true(LocalDataCore.load_device_file())
	assert_true(LocalDataCore.load_user_file(7))
	for kind: LocalDataCore.FileKind in [DEVICE, USER]:
		assert_eq(LocalDataCore.get_value_int(kind, "test.int_max", 0), 9223372036854775807)
		assert_eq(LocalDataCore.get_value_int(kind, "test.int_min", 0), -9223372036854775808)
		var zero: float = LocalDataCore.get_value_float(kind, "test.negative_zero", 1.0)
		assert_eq(LocalDataCore._float_bits(zero), NEGATIVE_ZERO_BITS, "-0.0 keeps its bits")
		assert_eq(LocalDataCore._float_bits(LocalDataCore.get_value_float(kind, "test.fraction", 0.0)),
				LocalDataCore._float_bits(0.1))
		assert_true(LocalDataCore.get_value_bool(kind, "test.yes", false))
		assert_false(LocalDataCore.get_value_bool(kind, "test.no", true))
		assert_eq(LocalDataCore.get_value_string(kind, "test.empty", "default"), "")
		assert_eq(LocalDataCore.get_value_string(kind, "test.non_ascii", ""), "한글 ünïcödé 日本 🎮")
		assert_eq(LocalDataCore.get_array_int(kind, "test.ints"), PackedInt64Array([1, -2, 9223372036854775807]))
		var floats: PackedFloat64Array = LocalDataCore.get_array_float(kind, "test.floats")
		assert_eq(floats.size(), 2)
		if floats.size() == 2:
			assert_eq(LocalDataCore._float_bits(floats[0]), NEGATIVE_ZERO_BITS)
			assert_eq(floats[1], 2.5)
		var expected_bools: Array[bool] = [true, false]
		assert_eq(LocalDataCore.get_array_bool(kind, "test.bools"), expected_bools)
		assert_eq(LocalDataCore.get_array_string(kind, "test.strings"), PackedStringArray(["", "ß", "😀"]))
		assert_eq(LocalDataCore.get_array_int(kind, "test.no_ints").size(), 0)
		assert_eq(LocalDataCore.get_array_float(kind, "test.no_floats").size(), 0)
		assert_eq(LocalDataCore.get_array_bool(kind, "test.no_bools").size(), 0)
		assert_eq(LocalDataCore.get_array_string(kind, "test.no_strings").size(), 0)
		assert_true(LocalDataCore._file_of(kind).entries.has("test.no_ints"), "an empty array is stored")
	assert_eq(warns(), 0)


func test_missing_key_gives_default_and_other_type_warns_once() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.missing", 5), 5)
	assert_eq(LocalDataCore.get_value_string(DEVICE, "test.missing", "x"), "x")
	assert_eq(LocalDataCore.get_array_int(DEVICE, "test.missing").size(), 0)
	assert_eq(warns(), 0, "a missing key does not log")
	LocalDataCore.set_value_string(DEVICE, "test.text", "abc")
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.text", 3), 3)
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.text", 3), 3)
	assert_eq(warns(), 1, "one warn for the key")


func test_set_with_another_type_replaces_the_type() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "test.value", 4)
	LocalDataCore.set_value_string(DEVICE, "test.value", "four")
	assert_eq(LocalDataCore.get_value_string(DEVICE, "test.value", ""), "four")
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.value", -1), -1)
	assert_eq(warns(), 1)


func test_string_array_read_as_int_array_is_empty_with_warn() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_array_string(DEVICE, "test.names", PackedStringArray(["a", "b"]))
	assert_eq(LocalDataCore.get_array_int(DEVICE, "test.names").size(), 0)
	assert_eq(warns(), 1)
	assert_eq(LocalDataCore.get_array_string(DEVICE, "test.names"), PackedStringArray(["a", "b"]))


func test_malformed_keys_give_default_with_one_error_per_key() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	for key: String in ["a", ".b", "a.B"]:
		assert_eq(LocalDataCore.get_value_int(DEVICE, key, 11), 11)
		assert_eq(LocalDataCore.get_value_int(DEVICE, key, 11), 11)
		LocalDataCore.set_value_int(DEVICE, key, 1)
		assert_eq(LocalDataCore.get_value_int(DEVICE, key, 12), 12, "set_value did not store " + key)
		assert_false(LocalDataCore._device.entries.has(key))
	assert_eq(errors(), 3, "one error per key")
	assert_false(LocalDataCore._device.dirty)


func test_same_value_does_not_make_the_file_kind_dirty() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "test.count", 1)
	LocalDataCore.set_value_float(DEVICE, "test.zero", 0.0)
	LocalDataCore.set_value_string(DEVICE, "test.name", "é")
	LocalDataCore.set_array_int(DEVICE, "test.ints", PackedInt64Array([1, 2]))
	LocalDataCore.set_array_float(DEVICE, "test.floats", PackedFloat64Array([0.5]))
	var bools: Array[bool] = [true]
	LocalDataCore.set_array_bool(DEVICE, "test.bools", bools)
	LocalDataCore.set_array_string(DEVICE, "test.strings", PackedStringArray(["x"]))
	LocalDataCore.flush()
	assert_false(LocalDataCore._device.dirty)
	LocalDataCore.set_value_int(DEVICE, "test.count", 1)
	LocalDataCore.set_value_float(DEVICE, "test.zero", 0.0)
	LocalDataCore.set_value_string(DEVICE, "test.name", "é")
	LocalDataCore.set_array_int(DEVICE, "test.ints", PackedInt64Array([1, 2]))
	LocalDataCore.set_array_float(DEVICE, "test.floats", PackedFloat64Array([0.5]))
	var same_bools: Array[bool] = [true]
	LocalDataCore.set_array_bool(DEVICE, "test.bools", same_bools)
	LocalDataCore.set_array_string(DEVICE, "test.strings", PackedStringArray(["x"]))
	LocalDataCore.remove_value(DEVICE, "test.not_there")
	assert_false(LocalDataCore._device.dirty, "same type and value")
	assert_false(LocalDataCore._waiting)
	LocalDataCore.set_value_float(DEVICE, "test.zero", negative_zero())
	assert_true(LocalDataCore._device.dirty, "-0.0 has other bits than 0.0")


func test_stored_array_is_a_copy() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	var ints: PackedInt64Array = PackedInt64Array([1, 2])
	LocalDataCore.set_array_int(DEVICE, "test.ints", ints)
	ints[0] = 9
	var read: PackedInt64Array = LocalDataCore.get_array_int(DEVICE, "test.ints")
	read[1] = 8
	assert_eq(LocalDataCore.get_array_int(DEVICE, "test.ints"), PackedInt64Array([1, 2]))
	var bools: Array[bool] = [true, true]
	LocalDataCore.set_array_bool(DEVICE, "test.bools", bools)
	bools[0] = false
	var read_bools: Array[bool] = LocalDataCore.get_array_bool(DEVICE, "test.bools")
	read_bools[1] = false
	var expected: Array[bool] = [true, true]
	assert_eq(LocalDataCore.get_array_bool(DEVICE, "test.bools"), expected)
	var names: PackedStringArray = PackedStringArray(["a"])
	LocalDataCore.set_array_string(DEVICE, "test.names", names)
	names[0] = "b"
	assert_eq(LocalDataCore.get_array_string(DEVICE, "test.names"), PackedStringArray(["a"]))
	var floats: PackedFloat64Array = PackedFloat64Array([1.0])
	LocalDataCore.set_array_float(DEVICE, "test.floats", floats)
	floats[0] = 2.0
	assert_eq(LocalDataCore.get_array_float(DEVICE, "test.floats"), PackedFloat64Array([1.0]))


func test_user_file_of_another_user_does_not_have_the_value() -> void:
	start()
	assert_true(LocalDataCore.load_user_file(1))
	LocalDataCore.set_value_int(USER, "test.score", 10)
	restart()
	assert_true(LocalDataCore.load_user_file(2))
	assert_eq(LocalDataCore.get_value_int(USER, "test.score", -1), -1)
	assert_true(LocalDataCore._user.entries.is_empty())
	restart()
	assert_true(LocalDataCore.load_user_file(1))
	assert_eq(LocalDataCore.get_value_int(USER, "test.score", -1), 10)


func test_file_bytes_do_not_depend_on_the_locale() -> void:
	var locale: String = TranslationServer.get_locale()
	var written: Array[PackedByteArray] = []
	for test_locale: String in ["tr_TR", "en_US", "ar_EG"]:
		TranslationServer.set_locale(test_locale)
		start()
		assert_true(LocalDataCore.load_device_file())
		LocalDataCore.set_value_string(DEVICE, "test.text", "Iıİi 1.5")
		LocalDataCore.set_value_float(DEVICE, "test.ratio", 1234.5)
		LocalDataCore.set_value_int(DEVICE, "test.count", -1234567)
		LocalDataCore.set_array_string(DEVICE, "test.names", PackedStringArray(["Zed", "alpha", "Émile"]))
		LocalDataCore.set_value_bool(DEVICE, "inventory.sort_mode", true)
		LocalDataCore.release()
		written.append(read_raw(DEVICE_FILE))
		remove_tree(ROOT)
	TranslationServer.set_locale(locale)
	assert_false(written[0].is_empty())
	assert_eq(written[1], written[0])
	assert_eq(written[2], written[0])


func test_user_file_name_is_the_hash_of_the_user_id() -> void:
	start()
	assert_true(LocalDataCore.load_user_file(42))
	LocalDataCore.set_value_int(USER, "test.value", 1)
	LocalDataCore.flush()
	var name: String = "user_" + UtilCore.sha256_hex("42".to_ascii_buffer()).substr(0, 16) + ".dat"
	assert_eq(name, "user_73475cb40a568e8d.dat")
	assert_true(raw_exists("local_data/" + name))


func test_file_bytes_do_not_depend_on_the_key_order() -> void:
	var keys: PackedStringArray = PackedStringArray(["z.a", "a.b", "a.a", "Z.a", "é.a", "a_b.a"])
	var written: Array[PackedByteArray] = []
	for reverse: bool in [false, true]:
		start()
		assert_true(LocalDataCore.load_device_file())
		for i in keys.size():
			var key: String = keys[keys.size() - 1 - i] if reverse else keys[i]
			LocalDataCore.set_value_int(DEVICE, key, key.length())
		LocalDataCore.release()
		written.append(read_raw(DEVICE_FILE))
		remove_tree(ROOT)
	assert_false(written[0].is_empty())
	assert_eq(written[1], written[0])
	var reader: StreamPeerBuffer = StreamPeerBuffer.new()
	reader.data_array = written[0]
	reader.seek(8)
	var order: PackedStringArray = PackedStringArray()
	for i in keys.size():
		var key_bytes: PackedByteArray = reader.get_data(reader.get_u32())[1]
		order.append(key_bytes.get_string_from_utf8())
		reader.seek(reader.get_position() + 9)
	assert_eq(order, PackedStringArray(["Z.a", "a.a", "a.b", "a_b.a", "z.a", "é.a"]), "key UTF-8 byte order")


func test_file_bytes_follow_the_format() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_int(DEVICE, "t.a", -2)
	LocalDataCore.set_value_float(DEVICE, "t.b", 1.0)
	LocalDataCore.set_value_bool(DEVICE, "t.c", true)
	LocalDataCore.set_value_string(DEVICE, "t.d", "é")
	LocalDataCore.set_array_int(DEVICE, "t.e", PackedInt64Array([1]))
	LocalDataCore.set_array_float(DEVICE, "t.f", PackedFloat64Array([2.0]))
	var bools: Array[bool] = [false, true]
	LocalDataCore.set_array_bool(DEVICE, "t.g", bools)
	LocalDataCore.set_array_string(DEVICE, "t.h", PackedStringArray(["x"]))
	LocalDataCore.flush()
	var expected: PackedByteArray = PackedByteArray([1, 0, 0, 0, 8, 0, 0, 0])
	expected.append_array(_key("t.a") + PackedByteArray([1, 0xFE, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]))
	expected.append_array(_key("t.b") + PackedByteArray([2, 0, 0, 0, 0, 0, 0, 0xF0, 0x3F]))
	expected.append_array(_key("t.c") + PackedByteArray([3, 1]))
	expected.append_array(_key("t.d") + PackedByteArray([4, 2, 0, 0, 0, 0xC3, 0xA9]))
	expected.append_array(_key("t.e") + PackedByteArray([5, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]))
	expected.append_array(_key("t.f") + PackedByteArray([6, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40]))
	expected.append_array(_key("t.g") + PackedByteArray([7, 2, 0, 0, 0, 0, 1]))
	expected.append_array(_key("t.h") + PackedByteArray([8, 1, 0, 0, 0, 1, 0, 0, 0, 0x78]))
	assert_eq(read_raw(DEVICE_FILE), expected)


func test_file_kind_out_of_range_logs_every_call() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	var kind: LocalDataCore.FileKind = 7 as LocalDataCore.FileKind
	assert_false(LocalDataCore.is_loaded(kind))
	assert_eq(errors(), 0, "is_loaded does not log")
	assert_eq(LocalDataCore.get_value_int(kind, "test.value", 3), 3)
	assert_eq(LocalDataCore.get_value_int(kind, "test.value", 3), 3)
	assert_eq(errors(), 2, "an error per get_value")
	assert_eq(LocalDataCore.get_array_string(kind, "bad").size(), 0)
	LocalDataCore.set_value_int(kind, "bad", 1)
	LocalDataCore.set_array_int(kind, "test.values", PackedInt64Array([1]))
	LocalDataCore.remove_value(kind, "test.value")
	assert_eq(errors(), 4, "an error per call and no key error")
	assert_false(LocalDataCore._device.dirty)
	assert_true(LocalDataCore._device.entries.is_empty())
	assert_true(LocalDataCore._bad_key_logged.is_empty())


func test_malformed_key_before_the_load_logs_only_the_load_error() -> void:
	start()
	assert_eq(LocalDataCore.get_value_int(DEVICE, "bad", 4), 4)
	LocalDataCore.set_value_int(DEVICE, "a.B", 1)
	assert_eq(errors(), 1, "one error for the file kind before its load")
	assert_true(LocalDataCore._bad_key_logged.is_empty())
	assert_true(LocalDataCore.load_device_file())
	assert_eq(LocalDataCore.get_value_int(DEVICE, "bad", 4), 4)
	assert_eq(errors(), 1, "the key error after the load")


func test_malformed_key_is_checked_before_the_stored_type() -> void:
	start()
	assert_true(LocalDataCore.load_device_file())
	LocalDataCore.set_value_string(DEVICE, "test.text", "abc")
	assert_eq(LocalDataCore.get_value_int(DEVICE, "test.text", 2), 2)
	assert_eq(warns(), 1)
	assert_eq(errors(), 0)
	LocalDataCore.set_value_string(USER, "test.text", "abc")
	assert_eq(errors(), 1, "the user file kind is not loaded")
	assert_true(LocalDataCore.load_user_file(4))
	LocalDataCore.set_value_string(USER, "test.text", "abc")
	assert_eq(LocalDataCore.get_value_int(USER, "test.text", 2), 2)
	assert_eq(warns(), 1, "a warn per file kind and key")
	assert_eq(LocalDataCore.get_value_int(USER, "test.text", 2), 2)
	assert_eq(warns(), 0)


func _key(key: String) -> PackedByteArray:
	var bytes: PackedByteArray = PackedByteArray([key.length(), 0, 0, 0])
	bytes.append_array(key.to_utf8_buffer())
	return bytes
