extends UnitTestCase
## `DataCore.load`: downloaded data checks, built-in data, data versions and `is_loaded`.

const Support := preload("res://core/data_core/tests/support/data_core_test_support.gd")
const MISSING_LOCATION: String = "res://core/data_core/tests/no_data/"

var _load_done: bool = false
var _load_result: bool = true


## Downloaded data that fails one check: how to make it and the `error` logs the fallback leaves.
class FallbackCase:
	extends RefCounted
	var name: String = ""
	var version: String = ""
	var replaced: Dictionary[String, PackedByteArray] = {}
	var omitted: PackedStringArray = PackedStringArray()
	var unwritten: PackedStringArray = PackedStringArray()
	var wrong_hash: PackedStringArray = PackedStringArray()
	var errors: int = 0

	func _init(
		case_name: String,
		data_version: String,
		replaced_files: Dictionary[String, PackedByteArray],
		omitted_files: PackedStringArray = PackedStringArray(),
		unwritten_files: PackedStringArray = PackedStringArray(),
		wrong_hash_files: PackedStringArray = PackedStringArray(),
		error_count: int = 0,
	) -> void:
		name = case_name
		version = data_version
		replaced = replaced_files
		omitted = omitted_files
		unwritten = unwritten_files
		wrong_hash = wrong_hash_files
		errors = error_count


func before_each() -> void:
	super()
	assert_true(Support.init_modules())


func after_each() -> void:
	super()
	Support.release_modules()


func test_valid_downloaded_data_is_loaded_with_its_version() -> void:
	var downloaded: DownloadedData = Support.write_valid_downloaded("data_core_test/valid", "valid")
	assert_true(await DataCore.load(downloaded))
	assert_eq(DataCore.get_data_version(), downloaded.data_version)
	assert_ne(DataCore.get_data_version(), DataCore.get_builtin_data_version())
	assert_true(GameData.ExperimentTable.has_row(Support.EXTRA_ID))


func test_downloaded_table_binaries_without_translation_and_version_pass_check_3() -> void:
	var builtin: PackedStringArray = Support.builtin_file_names()
	assert_true(builtin.has("data_version"))
	var translations: int = 0
	for name: String in builtin:
		if name.begins_with("translation_"):
			translations += 1
	assert_gt(translations, 0)
	var downloaded: DownloadedData = Support.write_valid_downloaded("data_core_test/tables", "tables")
	var names: PackedStringArray = PackedStringArray()
	for path: String in downloaded.files:
		names.append(path.get_file())
	names.sort()
	assert_eq(names, Support.table_names())
	assert_true(await DataCore.load(downloaded))
	assert_eq(DataCore.get_data_version(), downloaded.data_version)


func test_load_without_downloaded_data_uses_builtin_data() -> void:
	assert_true(await DataCore.load(null))
	assert_eq(DataCore.get_data_version(), DataCore.get_builtin_data_version())
	assert_eq(DataCore.get_data_version(), Support.builtin_version())
	assert_false(GameData.ExperimentTable.has_row(Support.EXTRA_ID))


func test_downloaded_data_failing_a_check_falls_back_to_builtin_data() -> void:
	var protocol: String = Support.protocol_hash()
	var data: String = UtilCore.sha256_hex("other".to_utf8_buffer())
	var extra: Dictionary[String, PackedByteArray] = {"experiment.bin": Support.extra_row_bytes()}
	var bad_decode: Dictionary[String, PackedByteArray] = {"experiment.bin": PackedByteArray([0x0A, 0x05])}
	var no_files: PackedStringArray = Support.table_names()
	var one_file: PackedStringArray = PackedStringArray(["item.bin"])
	var none: PackedStringArray = PackedStringArray()
	var valid: String = protocol + "-" + data
	var cases: Array[FallbackCase] = [
		FallbackCase.new("protocol hash differs", UtilCore.sha256_hex("p".to_utf8_buffer()) + "-" + data, extra),
		FallbackCase.new("no dash", protocol + "0" + data, extra),
		FallbackCase.new("two dashes", protocol + "-" + data.left(31) + "-" + data.substr(32), extra),
		FallbackCase.new("upper case hash", protocol + "-A" + data.substr(1), extra),
		FallbackCase.new("non-hex hash", protocol + "-g" + data.substr(1), extra),
		FallbackCase.new("63-char hash", protocol + "-" + data.substr(1), extra),
		FallbackCase.new("CR", protocol + "-" + data.left(63) + "\r", extra),
		FallbackCase.new("LF", protocol + "-" + data.left(63) + "\n", extra),
		FallbackCase.new("SHA-256 differs", valid, extra, none, none, one_file, 1),
		FallbackCase.new("file not readable", valid, extra, none, one_file, none, 1),
		FallbackCase.new("decode fails", valid, bad_decode, none, none, none, 1),
		FallbackCase.new("no files", valid, extra, no_files, none, none, 1),
		FallbackCase.new("built-in file missing", valid, extra, one_file, none, none, 1),
	]
	for i: int in cases.size():
		var c: FallbackCase = cases[i]
		DataCore.release()
		assert_true(DataCore.init())
		var folder: String = "data_core_test/case_%d" % i
		var downloaded: DownloadedData = Support.write_downloaded(folder, c.version, c.replaced, c.omitted, c.unwritten, c.wrong_hash)
		assert_true(await DataCore.load(downloaded), c.name)
		assert_eq(DataCore.get_data_version(), Support.builtin_version(), c.name)
		assert_false(GameData.ExperimentTable.has_row(Support.EXTRA_ID), c.name)
		if c.errors > 0:
			assert_eq(Support.errors(), c.errors, c.name)


func test_downloaded_file_over_the_max_bytes_falls_back_to_builtin_data() -> void:
	DataCore.release()
	assert_true(Support.set_max_file_bytes(1))
	assert_true(DataCore.init())
	var downloaded: DownloadedData = Support.write_valid_downloaded("data_core_test/large", "large")
	assert_true(await DataCore.load(downloaded))
	assert_eq(DataCore.get_data_version(), Support.builtin_version())
	assert_false(GameData.ExperimentTable.has_row(Support.EXTRA_ID))
	assert_eq(Support.errors(), 1)


func test_load_fails_when_downloaded_and_builtin_data_both_fail() -> void:
	var bad: Dictionary[String, PackedByteArray] = {"experiment.bin": PackedByteArray([0x0A, 0x05])}
	var builtin: DownloadedData = Support.write_downloaded("data_core_test/builtin", Support.builtin_version(), bad)
	assert_true(LocalDataCore.write_file("data_core_test/builtin/data_version", (Support.builtin_version() + "\n").to_utf8_buffer()).ok)
	var location: String = LocalDataCore.resolve_engine_path("data_core_test/builtin/data_version").get_base_dir() + "/"
	assert_eq(builtin.files.size(), Support.table_names().size())
	DataCore.release()
	DataCoreDev.set_test_data_location(location)
	assert_true(DataCore.init())
	var downloaded: DownloadedData = Support.write_downloaded("data_core_test/downloaded", Support.other_version("both"), bad)
	assert_false(await DataCore.load(downloaded))
	assert_false(DataCore.is_loaded())
	for name: String in Support.table_names():
		assert_eq(GameData.table_rows(name.get_basename()).size(), 0, name)
	assert_eq(DataCore.get_data_version(), "")
	# The downloaded decode, the built-in decode and `get_data_version`.
	assert_eq(Support.errors(), 3)


func test_unreadable_builtin_version_logs_on_every_call_and_fails_load() -> void:
	DataCore.release()
	DataCoreDev.set_test_data_location(MISSING_LOCATION)
	assert_true(DataCore.init())
	assert_eq(DataCore.get_builtin_data_version(), "")
	assert_eq(Support.errors(), 1)
	assert_eq(DataCore.get_builtin_data_version(), "")
	assert_eq(Support.errors(), 1)
	assert_false(await DataCore.load(null))
	assert_eq(Support.errors(), 1)


func test_load_fills_every_table_and_game_setting_of_the_core_test_data() -> void:
	assert_true(await DataCore.load(null))
	var names: PackedStringArray = Support.table_names()
	assert_gt(names.size(), 0)
	for name: String in names:
		var rows: int = Support.count_rows(Support.table_bytes(name))
		assert_gt(rows, -1, name)
		assert_eq(GameData.table_rows(name.get_basename()).size(), rows, name)
	assert_eq(GameSetting.data_core_setting(), 42)


func test_second_load_fails_and_keeps_the_data() -> void:
	assert_true(await DataCore.load(null))
	var version: String = DataCore.get_data_version()
	var rows: int = GameData.ItemTable.all_rows().size()
	var downloaded: DownloadedData = Support.write_valid_downloaded("data_core_test/second", "second")
	assert_false(await DataCore.load(downloaded))
	assert_eq(Support.errors(), 1)
	assert_eq(DataCore.get_data_version(), version)
	assert_eq(GameData.ItemTable.all_rows().size(), rows)
	assert_false(GameData.ExperimentTable.has_row(Support.EXTRA_ID))


func test_data_version_before_load_is_empty() -> void:
	assert_eq(DataCore.get_data_version(), "")
	assert_eq(Support.errors(), 1)


func test_is_loaded_before_after_success_after_failure_and_after_release() -> void:
	assert_false(DataCore.is_loaded())
	assert_true(await DataCore.load(null))
	assert_true(DataCore.is_loaded())
	DataCore.release()
	DataCoreDev.set_test_data_location(MISSING_LOCATION)
	assert_true(DataCore.init())
	assert_false(await DataCore.load(null))
	assert_eq(Support.errors(), 1)
	assert_false(DataCore.is_loaded())
	DataCore.release()
	assert_false(DataCore.is_loaded())


func test_release_during_load_ends_it_with_false() -> void:
	_load_into_result()
	assert_false(_load_done)
	DataCore.release()
	assert_true(_load_done)
	assert_false(_load_result)
	assert_false(DataCore.is_loaded())


func _load_into_result() -> void:
	_load_result = await DataCore.load(null)
	_load_done = true
