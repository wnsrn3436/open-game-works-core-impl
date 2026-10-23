extends "res://core/game_update_core/tests/support/game_update_test_case.gd"
## File update: which files are downloaded, in which order, resume, saving, folder cleanup and progress.

## Paths `_hash_and_record` hashed in this test.
var _hashed: PackedStringArray = PackedStringArray()
## `FileError` that `_fail_write` returns.
var _write_error: LocalDataCore.FileError = LocalDataCore.FileError.FAILED


func after_each() -> void:
	await super()
	# GUT runs every test of a file on one instance.
	_hashed = PackedStringArray()


func test_builtin_data_version_downloads_no_data_or_translation() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _full_list(DataCore.get_builtin_data_version())
	serve(list)
	assert_true(await GameUpdateCore.check_update(make_source()))
	assert_eq(_file_calls(), PackedStringArray([FILE_BASE + list.bundle_files[0].sha256]))
	assert_null(GameUpdateCore.downloaded_data())
	assert_eq(GameUpdateCore.downloaded_translations().size(), 0)
	assert_eq(GameUpdateCore.downloaded_bundles().size(), 1)


func test_other_protocol_hash_downloads_no_data_or_translation() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _full_list(other_protocol_version())
	serve(list)
	assert_true(await GameUpdateCore.check_update(make_source()))
	assert_eq(errors(), 1, "protocol hash error log")
	assert_eq(_file_calls(), PackedStringArray([FILE_BASE + list.bundle_files[0].sha256]))
	assert_null(GameUpdateCore.downloaded_data())
	assert_eq(GameUpdateCore.downloaded_translations().size(), 0)


func test_no_patch_entry_downloads_nothing_and_clears_folder() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_true(put_saved("item.bin", "old item table"))
	assert_true(put_saved("bundle_old.pck", "old bundle"))
	var list: _BUILDER = make_list()
	list.has_patch = false
	serve(list)
	assert_true(await GameUpdateCore.check_update(make_source()))
	assert_eq(_file_calls().size(), 0)
	assert_eq(LocalDataCore.list_files("game_update").size(), 0, "earlier files are deleted")
	assert_null(GameUpdateCore.downloaded_data())
	assert_eq(GameUpdateCore.downloaded_translations().size(), 0)
	assert_eq(GameUpdateCore.downloaded_bundles().size(), 0)


func test_files_download_in_list_order_and_queries_follow_the_list() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _full_list(other_data_version())
	list.data_files.append(make_file("shop.bin", "shop table"))
	var korean: _FILE = make_file("ko.bin", "korean")
	korean.language = "ko"
	list.translation_files.append(korean)
	var bundle_b: _FILE = make_file("bundle_b.pck", "bundle b")
	bundle_b.bundle = "bundle_b"
	list.bundle_files.append(bundle_b)
	serve(list)
	assert_true(await GameUpdateCore.check_update(make_source()))
	var expected: PackedStringArray = PackedStringArray()
	for file: _FILE in list.data_files:
		expected.append(FILE_BASE + file.sha256)
	for file: _FILE in list.translation_files:
		expected.append(FILE_BASE + file.sha256)
	for file: _FILE in list.bundle_files:
		expected.append(FILE_BASE + file.sha256)
	assert_eq(_file_calls(), expected)
	var data: DownloadedData = GameUpdateCore.downloaded_data()
	assert_not_null(data)
	if data != null:
		assert_eq(data.data_version, list.data_version)
		assert_eq(data.files.size(), 2)
		var item_sha256: String = data.files.get("game_update/item.bin", "")
		assert_eq(item_sha256, list.data_files[0].sha256)
		var shop_sha256: String = data.files.get("game_update/shop.bin", "")
		assert_eq(shop_sha256, list.data_files[1].sha256)
	var translations: Array[DownloadedTranslation] = GameUpdateCore.downloaded_translations()
	assert_eq(translations.size(), 2)
	if translations.size() == 2:
		assert_eq(translations[0].code, "en")
		assert_eq(translations[1].code, "ko")
		assert_eq(translations[1].path, "game_update/ko.bin")
		assert_eq(translations[1].sha256, korean.sha256)
		assert_eq(translations[1].data_version, list.data_version)
	var bundles: Array[DownloadedBundle] = GameUpdateCore.downloaded_bundles()
	assert_eq(bundles.size(), 2)
	if bundles.size() == 2:
		assert_eq(bundles[0].name, "bundle_a")
		assert_eq(bundles[1].name, "bundle_b")
		assert_eq(bundles[1].path, "game_update/bundle_b.pck")
		assert_eq(bundles[1].sha256, bundle_b.sha256)
	assert_eq(GameUpdateCore.downloaded_bundles().size(), 2, "the same result again")


func test_saved_file_with_same_size_and_sha256_is_not_downloaded_again() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _full_list(other_data_version())
	var same_size: _FILE = make_file("shop.bin", "shop table")
	list.data_files.append(same_size)
	serve(list)
	assert_true(put_saved("item.bin", "item table"), "same size and SHA-256")
	assert_true(put_saved("shop.bin", "shop tablX"), "same size, other SHA-256")
	assert_true(put_saved("en.bin", "english, longer"), "other size")
	assert_true(await GameUpdateCore.check_update(make_source()))
	assert_eq(downloader.count_calls(FILE_BASE + list.data_files[0].sha256), 0)
	assert_eq(downloader.count_calls(FILE_BASE + same_size.sha256), 1)
	assert_eq(downloader.count_calls(FILE_BASE + list.translation_files[0].sha256), 1)
	assert_eq(_read_saved("shop.bin"), "shop table")
	assert_eq(_read_saved("en.bin"), "english")


func test_saved_file_with_other_size_is_not_hashed() -> void:
	if not await start():
		fail_test("setup failed")
		return
	GameUpdateCore._file_hasher = _hash_and_record
	var list: _BUILDER = _full_list(other_data_version())
	serve(list)
	assert_true(put_saved("item.bin", "item table"), "same size and SHA-256")
	assert_true(put_saved("en.bin", "english, longer"), "other size")
	assert_true(await GameUpdateCore.check_update(make_source()))
	assert_eq(_hashed, PackedStringArray(["game_update/item.bin"]), "only the file of the same size is hashed")
	assert_eq(downloader.count_calls(FILE_BASE + list.data_files[0].sha256), 0)
	assert_eq(downloader.count_calls(FILE_BASE + list.translation_files[0].sha256), 1)


func test_response_with_wrong_size_or_sha256_leaves_file_unchanged() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	var bundle: _FILE = make_file("bundle_a.pck", "bundle a")
	bundle.bundle = "bundle_a"
	list.bundle_files = [bundle]
	serve(list)
	assert_true(put_saved("bundle_a.pck", "older bundle bytes"))
	downloader.clear(FILE_BASE + bundle.sha256)
	downloader.add_body(FILE_BASE + bundle.sha256, "bundle b".to_utf8_buffer())
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_invalid_file())
	assert_eq(_read_saved("bundle_a.pck"), "older bundle bytes", "SHA-256 differs")
	assert_true(await restart_module())
	serve(list)
	downloader.clear(FILE_BASE + bundle.sha256)
	downloader.add_body(FILE_BASE + bundle.sha256, "bundle".to_utf8_buffer())
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_invalid_file())
	assert_eq(_read_saved("bundle_a.pck"), "older bundle bytes", "size differs")


func test_failure_on_a_middle_file_keeps_queries_and_retry_starts_from_it() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _full_list(other_data_version())
	serve(list)
	var failing: String = FILE_BASE + list.translation_files[0].sha256
	downloader.clear(failing)
	downloader.add_body(failing, PackedByteArray(), 500)
	downloader.add_body(failing, list.translation_files[0].body)
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_download_failed())
	assert_null(GameUpdateCore.downloaded_data())
	assert_eq(GameUpdateCore.downloaded_translations().size(), 0)
	assert_eq(GameUpdateCore.downloaded_bundles().size(), 0)
	assert_eq(errors(), 3, "query before success")
	assert_true(await press(ReservedString.game_update_retry()))
	assert_true(check_finished)
	assert_true(check_result)
	assert_eq(downloader.count_calls(FILE_BASE + list.data_files[0].sha256), 1, "saved file is not downloaded again")
	assert_eq(downloader.count_calls(failing), 2)
	assert_eq(downloader.count_calls(FILE_BASE + list.bundle_files[0].sha256), 1)
	assert_not_null(GameUpdateCore.downloaded_data())


func test_save_failure_without_space_is_no_space_and_retry_saves() -> void:
	if not await start():
		fail_test("setup failed")
		return
	_write_error = LocalDataCore.FileError.NO_SPACE
	GameUpdateCore._file_writer = _fail_write
	var list: _BUILDER = make_list()
	list.bundle_files = [make_bundle_file("bundle_a.pck", "bundle a")]
	serve(list)
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_no_space())
	assert_false(LocalDataCore.file_exists("game_update/bundle_a.pck"))
	GameUpdateCore._file_writer = Callable()
	assert_true(await press(ReservedString.game_update_retry()))
	assert_true(check_finished)
	assert_true(check_result)
	assert_eq(_read_saved("bundle_a.pck"), "bundle a")


func test_other_save_failure_is_save_failed() -> void:
	if not await start():
		fail_test("setup failed")
		return
	_write_error = LocalDataCore.FileError.FAILED
	GameUpdateCore._file_writer = _fail_write
	var list: _BUILDER = make_list()
	list.bundle_files = [make_bundle_file("bundle_a.pck", "bundle a")]
	serve(list)
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_save_failed())
	assert_false(LocalDataCore.file_exists("game_update/bundle_a.pck"))


func test_download_folder_holds_only_the_files_to_download() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_true(put_saved("stale.bin", "stale"))
	assert_true(put_saved("item.bin", "item table"))
	var list: _BUILDER = _full_list(other_data_version())
	serve(list)
	assert_true(await GameUpdateCore.check_update(make_source()))
	assert_eq(LocalDataCore.list_files("game_update"), PackedStringArray(["bundle_a.pck", "en.bin", "item.bin"]))


func test_bytes_total_and_bytes_done_skip_resumed_files() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _full_list(other_data_version())
	serve(list)
	assert_true(put_saved("item.bin", "item table"))
	var pending_url: String = FILE_BASE + list.translation_files[0].sha256
	downloader.clear(pending_url)
	downloader.add_pending(pending_url)
	assert_eq(GameUpdateCore.bytes_total(), 0, "0 before the resume check")
	start_check(make_source())
	assert_true(downloader.is_pending())
	var total: int = list.translation_files[0].size + list.bundle_files[0].size
	assert_eq(GameUpdateCore.bytes_total(), total)
	assert_eq(GameUpdateCore.bytes_done(), 0)
	downloader.received = 3
	assert_eq(GameUpdateCore.bytes_done(), 3)
	assert_true(downloader.complete_pending(list.translation_files[0].body))
	assert_true(check_finished)
	assert_true(check_result)
	assert_eq(GameUpdateCore.bytes_done(), total)
	assert_eq(GameUpdateCore.bytes_total(), total)


func test_deploy_list_and_signature_downloads_are_not_counted() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _full_list(other_data_version())
	var bytes: PackedByteArray = list.to_bytes()
	downloader.add_pending(LIST_URL)
	downloader.add_pending(SIGNATURE_URL)
	serve_files(list.data_files)
	serve_files(list.translation_files)
	serve_files(list.bundle_files)
	start_check(make_source())
	assert_true(downloader.is_pending(), "the deploy list is downloading")
	downloader.received = 7
	assert_eq(GameUpdateCore.bytes_total(), 0)
	assert_eq(GameUpdateCore.bytes_done(), 0, "deploy list bytes")
	assert_true(downloader.complete_pending(bytes))
	assert_true(downloader.is_pending(), "the signature file is downloading")
	downloader.received = 9
	assert_eq(GameUpdateCore.bytes_total(), 0)
	assert_eq(GameUpdateCore.bytes_done(), 0, "signature file bytes")
	assert_true(downloader.complete_pending(signature_bytes(bytes, list.sequence)))
	assert_true(check_finished)
	assert_true(check_result)
	assert_eq(GameUpdateCore.bytes_done(), GameUpdateCore.bytes_total())


## `LocalDataCore.hash_file` that records the hashed path.
func _hash_and_record(path: String) -> FileResult:
	_hashed.append(path)
	return LocalDataCore.hash_file(path)


## `LocalDataCore.write_file` that writes nothing and fails with `_write_error`.
func _fail_write(_path: String, _bytes: PackedByteArray) -> FileResult:
	var result: FileResult = FileResult.new()
	result.error = _write_error
	return result


## `data_version` with one data, one translation and one bundle file.
func _full_list(data_version: String) -> _BUILDER:
	var list: _BUILDER = make_list()
	list.data_version = data_version
	list.data_files = [make_file("item.bin", "item table")]
	list.translation_files = [make_file("en.bin", "english")]
	list.translation_files[0].language = "en"
	list.bundle_files = [make_file("bundle_a.pck", "bundle a")]
	list.bundle_files[0].bundle = "bundle_a"
	return list


## Requested file URLs in order.
func _file_calls() -> PackedStringArray:
	var calls: PackedStringArray = PackedStringArray()
	for url: String in downloader.calls:
		if url.begins_with(FILE_BASE):
			calls.append(url)
	return calls


func _read_saved(name: String) -> String:
	var read: FileResult = LocalDataCore.read_file("game_update/" + name, 1024)
	return read.bytes.get_string_from_utf8() if read.ok else ""
