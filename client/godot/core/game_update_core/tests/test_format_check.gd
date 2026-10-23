extends "res://core/game_update_core/tests/support/game_update_test_case.gd"
## Deploy list format check and the stored sequence of each environment.

const _SEQUENCE_DEV: String = "GameUpdateCore.sequence_dev"
const _SEQUENCE_STG: String = "GameUpdateCore.sequence_stg"


func test_each_format_check_item_fails_alone() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var cases: PackedStringArray = PackedStringArray([
		"format", "environment", "sequence", "field type", "version form", "data_version form", "name chars",
		"name dot", "name tmp", "name bak", "duplicate name", "duplicate language", "size zero", "size over",
		"sha256 form",
	])
	for case_name: String in cases:
		var list: _BUILDER = _valid_list()
		LocalDataCore.remove_value(LocalDataCore.FileKind.DEVICE, _SEQUENCE_DEV)
		if case_name == "sequence":
			LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, _SEQUENCE_DEV, list.sequence + 1)
		_break(list, case_name)
		serve(list)
		start_check(make_source())
		await pump()
		assert_true(popup_shows(ReservedString.game_update_invalid_file()), case_name + ": invalid file")
		assert_eq(errors(), 1, case_name + ": one error log")
		assert_eq(LocalDataCore.list_files("game_update").size(), 0, case_name + ": nothing written")
		assert_true(await restart_module(), case_name + ": init again")


func test_valid_list_passes_and_stores_sequence() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _valid_list()
	serve(list)
	assert_true(await GameUpdateCore.check_update(make_source()))
	assert_eq(LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _SEQUENCE_DEV, 0), list.sequence)


func test_name_shared_by_data_and_bundle_files_writes_nothing() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _valid_list()
	list.bundle_files = [make_bundle_file(list.data_files[0].name, "other bytes")]
	serve(list)
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_invalid_file())
	assert_false(LocalDataCore.file_exists("game_update/" + list.data_files[0].name))


func test_stg_list_compares_only_with_stg_sequence() -> void:
	if not await start():
		fail_test("setup failed")
		return
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, _SEQUENCE_DEV, 900000)
	var list: _BUILDER = _valid_list()
	list.environment = "STG"
	list.sequence = 1000
	serve(list)
	var source: UpdateSource = make_source()
	source.environment = "STG"
	assert_true(await GameUpdateCore.check_update(source))
	assert_eq(LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _SEQUENCE_STG, 0), 1000)
	assert_eq(LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _SEQUENCE_DEV, 0), 900000)


func _valid_list() -> _BUILDER:
	var list: _BUILDER = make_list()
	list.data_version = other_data_version()
	list.data_files = [make_file("item.bin", "item table")]
	list.translation_files = [make_file("en.bin", "english")]
	list.translation_files[0].language = "en"
	list.bundle_files = [make_file("bundle_a.pck", "bundle a")]
	list.bundle_files[0].bundle = "bundle_a"
	return list


## Breaks one format check item of `list`.
func _break(list: _BUILDER, case_name: String) -> void:
	match case_name:
		"format":
			list.format_json = "2"
		"environment":
			list.environment = "STG"
		"field type":
			list.data_files[0].size_json = "\"" + str(list.data_files[0].size) + "\""
		"version form":
			list.min_version = "1.0"
		"data_version form":
			list.data_version = list.data_version.to_upper()
		"name chars":
			list.data_files[0].name = "Item.bin"
		"name dot":
			list.data_files[0].name = ".item"
		"name tmp":
			list.data_files[0].name = "item.tmp"
		"name bak":
			list.data_files[0].name = "item.bak"
		"duplicate name":
			list.bundle_files[0].name = list.translation_files[0].name
		"duplicate language":
			var second: _FILE = make_file("en2.bin", "english again")
			second.language = "en"
			list.translation_files.append(second)
		"size zero":
			list.data_files[0].size_json = "0"
		"size over":
			list.data_files[0].size_json = str(CoreSettings.get_int("GameUpdateCore.fileMaxBytes") + 1)
		"sha256 form":
			list.data_files[0].sha256 = list.data_files[0].sha256.to_upper()
