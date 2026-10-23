extends "res://core/game_update_core/tests/support/game_update_test_case.gd"
## Stall timeout on the test clock.

const _STALL_MS: int = 5000


func test_stall_fails_at_stall_timeout_and_drops_the_late_result() -> void:
	if not await start(_STALL_MS):
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	var bundle: _FILE = make_bundle_file("bundle_a.pck", "bundle a")
	list.bundle_files = [bundle]
	serve(list)
	downloader.clear(FILE_BASE + bundle.sha256)
	downloader.add_pending(FILE_BASE + bundle.sha256)
	start_check(make_source())
	assert_true(downloader.is_pending())
	UnitTestCore.advance_clock(_STALL_MS - 1, false)
	await UnitTestCore.wait_frames(2)
	assert_true(downloader.is_pending(), "not failed at stall timeout - 1")
	assert_eq(downloader.cancel_count, 0)
	UnitTestCore.advance_clock(1, false)
	await UnitTestCore.wait_frames(2)
	assert_false(downloader.is_pending(), "failed at stall timeout")
	assert_eq(downloader.cancel_count, 1)
	await expect_fetch_failure(ReservedString.game_update_download_failed())
	assert_false(downloader.complete_pending(bundle.body), "the late result has no download to end")
	assert_false(LocalDataCore.file_exists("game_update/bundle_a.pck"))


func test_growing_bytes_restart_the_stall_timeout() -> void:
	if not await start(_STALL_MS):
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	var bundle: _FILE = make_bundle_file("bundle_a.pck", "bundle a")
	list.bundle_files = [bundle]
	serve(list)
	downloader.clear(FILE_BASE + bundle.sha256)
	downloader.add_pending(FILE_BASE + bundle.sha256)
	start_check(make_source())
	UnitTestCore.advance_clock(_STALL_MS - 1, false)
	await UnitTestCore.wait_frames(2)
	downloader.received = 1
	await UnitTestCore.wait_frames(2)
	UnitTestCore.advance_clock(_STALL_MS - 1, false)
	await UnitTestCore.wait_frames(2)
	assert_true(downloader.is_pending(), "the stall timeout counts from the last growth")
	assert_true(downloader.complete_pending(bundle.body))
	assert_true(check_finished)
	assert_true(check_result)


func test_stall_drops_a_late_result_that_came_after_the_cancel() -> void:
	if not await start(_STALL_MS):
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	var bundle: _FILE = make_bundle_file("bundle_a.pck", "bundle a")
	list.bundle_files = [bundle]
	serve(list)
	downloader.clear(FILE_BASE + bundle.sha256)
	downloader.add_pending(FILE_BASE + bundle.sha256)
	downloader.cancel_ends_pending = false
	start_check(make_source())
	UnitTestCore.advance_clock(_STALL_MS, false)
	await UnitTestCore.wait_frames(2)
	assert_eq(downloader.cancel_count, 1, "cancelled at stall timeout")
	assert_true(downloader.is_pending(), "the download did not end at the cancel")
	assert_true(downloader.complete_pending(bundle.body), "a 200 response with the right body comes late")
	await expect_fetch_failure(ReservedString.game_update_download_failed())
	assert_false(LocalDataCore.file_exists("game_update/bundle_a.pck"), "the late result is dropped")
	assert_eq(GameUpdateCore.bytes_done(), 0)
