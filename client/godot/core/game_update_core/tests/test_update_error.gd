extends "res://core/game_update_core/tests/support/game_update_test_case.gd"
## Fetch failure close, `UpdateRequiredEvent` popups and in play.

const _APP: int = CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED
const _DATA: int = CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED


func test_fetch_failure_popup_closed_without_button_requests_restart() -> void:
	if not await start():
		fail_test("setup failed")
		return
	downloader.add_body(LIST_URL, PackedByteArray(), 503)
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_download_failed())
	await close_popups()
	assert_eq(restarts.count, 1)
	assert_eq(restarts.modules, PackedStringArray([TAG]))
	assert_true(check_finished)
	assert_false(check_result)


func test_fetch_failure_popup_that_cannot_open_ends_check_update_with_false() -> void:
	if not await start():
		fail_test("setup failed")
		return
	downloader.add_body(LIST_URL, PackedByteArray(), 503)
	UICore.release()
	start_check(make_source())
	await pump()
	assert_true(UnitTestCore.check_logs("error", "UICore") > 0, "UICore could not open the popup")
	assert_true(check_finished)
	assert_false(check_result)
	assert_eq(errors(), 2, "error logs for the fetch failure and the popup")
	assert_eq(downloader.count_calls(LIST_URL), 1, "no retry")
	assert_eq(restarts.count, 0)


func test_retry_downloads_the_failed_deploy_list_again() -> void:
	if not await start():
		fail_test("setup failed")
		return
	downloader.add_body(LIST_URL, PackedByteArray(), 503)
	serve(make_list())
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_download_failed())
	assert_true(await press(ReservedString.game_update_retry()))
	assert_true(check_finished)
	assert_true(check_result)
	assert_eq(downloader.count_calls(LIST_URL), 2)
	assert_eq(restarts.count, 0)


func test_update_required_opens_one_popup_per_code() -> void:
	if not await start():
		fail_test("setup failed")
		return
	publish_update_required(_APP)
	await pump()
	assert_true(popup_shows(ReservedString.game_update_app_update_required()))
	assert_eq(popup_count(), 1)
	publish_update_required(_APP)
	publish_update_required(_DATA)
	await pump()
	assert_eq(popup_count(), 1, "no popup while the forced update popup is open")
	assert_true(await restart_module())
	publish_update_required(_DATA)
	await pump()
	assert_true(popup_shows(ReservedString.game_update_data_update_required()))
	assert_eq(popup_count(), 1)
	publish_update_required(_DATA)
	await pump()
	assert_eq(popup_count(), 1, "no popup while the new data popup is open")


func test_new_data_popup_button_requests_restart_once() -> void:
	if not await start():
		fail_test("setup failed")
		return
	publish_update_required(_DATA)
	await pump()
	assert_true(await press(ReservedString.game_update_restart()))
	assert_eq(restarts.count, 1)
	assert_eq(popup_count(), 0)


func test_new_data_popup_closed_without_button_requests_restart_once() -> void:
	if not await start():
		fail_test("setup failed")
		return
	publish_update_required(_DATA)
	await pump()
	await close_popups()
	assert_eq(restarts.count, 1)


func test_data_update_in_play_waits_for_play_end() -> void:
	if not await start():
		fail_test("setup failed")
		return
	GameUpdateCore.set_in_play(true)
	publish_update_required(_DATA)
	publish_update_required(_DATA)
	await pump()
	assert_eq(popup_count(), 0, "no popup in play")
	GameUpdateCore.set_in_play(false)
	await pump()
	assert_eq(popup_count(), 1)
	assert_true(popup_shows(ReservedString.game_update_data_update_required()))


func test_app_update_in_play_opens_at_once() -> void:
	if not await start():
		fail_test("setup failed")
		return
	GameUpdateCore.set_in_play(true)
	publish_update_required(_APP)
	await pump()
	assert_eq(popup_count(), 1)
	assert_true(popup_shows(ReservedString.game_update_app_update_required()))


func test_play_end_without_data_update_opens_nothing() -> void:
	if not await start():
		fail_test("setup failed")
		return
	GameUpdateCore.set_in_play(true)
	await pump()
	GameUpdateCore.set_in_play(false)
	await pump()
	assert_eq(popup_count(), 0)
