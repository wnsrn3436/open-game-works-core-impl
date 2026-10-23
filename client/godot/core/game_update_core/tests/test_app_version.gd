extends "res://core/game_update_core/tests/support/game_update_test_case.gd"
## App version check: forced update popup, optional update popup and the skipped check.


func test_forced_update_popup_opens_again_and_check_update_does_not_end() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	list.min_version = "2.0.0"
	list.recommended_version = "2.0.0"
	list.bundle_files = [make_bundle_file("bundle_a.pck", "bundle a")]
	serve(list)
	start_check(make_source())
	await pump()
	assert_true(popup_shows(ReservedString.game_update_app_update_required()))
	assert_eq(popup_count(), 1)
	assert_true(await press(ReservedString.game_update_go_to_store()))
	assert_eq(store_urls, PackedStringArray([list.store_url]), "store redirect to store_url")
	assert_true(popup_shows(ReservedString.game_update_app_update_required()), "opens again after the button")
	assert_eq(popup_count(), 1)
	await close_popups()
	assert_true(popup_shows(ReservedString.game_update_app_update_required()), "opens again after a close")
	assert_eq(popup_count(), 1)
	assert_false(check_finished)
	assert_eq(downloader.count_calls(FILE_BASE + list.bundle_files[0].sha256), 0, "no file update")
	assert_eq(restarts.count, 0)


func test_optional_update_later_continues_file_update() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _optional_list()
	serve(list)
	start_check(make_source())
	await pump()
	assert_true(popup_shows(ReservedString.game_update_recommended()))
	assert_false(check_finished)
	assert_true(await press(ReservedString.game_update_later()))
	assert_true(check_finished)
	assert_true(check_result)
	assert_eq(downloader.count_calls(FILE_BASE + list.bundle_files[0].sha256), 1, "file update ran")
	assert_eq(popup_count(), 0)


func test_optional_update_closed_without_button_continues_file_update() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _optional_list()
	serve(list)
	start_check(make_source())
	await pump()
	assert_true(popup_shows(ReservedString.game_update_recommended()))
	await close_popups()
	assert_true(check_finished)
	assert_true(check_result)
	assert_eq(downloader.count_calls(FILE_BASE + list.bundle_files[0].sha256), 1, "file update ran")
	assert_eq(restarts.count, 0)


func test_optional_update_store_button_redirects_and_opens_again() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _optional_list()
	serve(list)
	start_check(make_source())
	await pump()
	assert_true(await press(ReservedString.game_update_go_to_store()))
	assert_eq(store_urls, PackedStringArray([list.store_url]))
	assert_true(popup_shows(ReservedString.game_update_recommended()), "opens again after the store redirect")
	assert_false(check_finished)


func test_empty_app_version_or_url_does_not_download() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var no_version: UpdateSource = make_source()
	no_version.app_version = ""
	assert_true(await GameUpdateCore.check_update(no_version))
	assert_eq(downloader.calls.size(), 0, "no download without app_version")
	assert_null(GameUpdateCore.downloaded_data())
	assert_eq(GameUpdateCore.downloaded_translations().size(), 0)
	assert_eq(GameUpdateCore.downloaded_bundles().size(), 0)
	assert_true(await restart_module())
	var no_url: UpdateSource = make_source()
	no_url.game_update_url = ""
	assert_true(await GameUpdateCore.check_update(no_url))
	assert_eq(downloader.calls.size(), 0, "no download without game_update_url")


func test_app_version_at_recommended_version_has_no_popup() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	list.min_version = "1.0.0"
	list.recommended_version = APP_VERSION
	serve(list)
	assert_true(await GameUpdateCore.check_update(make_source()))
	assert_eq(popup_count(), 0)


func test_missing_platform_entry_warns_and_continues() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	list.has_app_entry = false
	serve(list)
	assert_true(await GameUpdateCore.check_update(make_source()))
	assert_eq(UnitTestCore.check_logs("warn", TAG), 1)


func test_forced_update_popup_that_cannot_open_ends_check_update_with_false() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	list.min_version = "2.0.0"
	list.recommended_version = "2.0.0"
	list.bundle_files = [make_bundle_file("bundle_a.pck", "bundle a")]
	serve(list)
	UICore.release()
	start_check(make_source())
	await pump()
	assert_true(UnitTestCore.check_logs("error", "UICore") > 0, "UICore could not open the popup")
	assert_true(check_finished)
	assert_false(check_result)
	assert_eq(errors(), 1, "error log for the popup")
	assert_eq(downloader.count_calls(FILE_BASE + list.bundle_files[0].sha256), 0, "no file update")


func test_optional_update_popup_that_cannot_open_is_later() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = _optional_list()
	serve(list)
	UICore.release()
	start_check(make_source())
	await pump()
	assert_true(UnitTestCore.check_logs("error", "UICore") > 0, "UICore could not open the popup")
	assert_true(check_finished)
	assert_true(check_result)
	assert_eq(errors(), 1, "error log for the popup")
	assert_eq(downloader.count_calls(FILE_BASE + list.bundle_files[0].sha256), 1, "file update ran")


func _optional_list() -> _BUILDER:
	var list: _BUILDER = make_list()
	list.min_version = "1.0.0"
	list.recommended_version = "1.3.0"
	list.bundle_files = [make_bundle_file("bundle_a.pck", "bundle a")]
	return list
