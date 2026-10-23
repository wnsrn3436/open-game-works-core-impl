extends "res://core/game_update_core/tests/support/game_update_test_case.gd"
## Lifecycle, the second `check_update`, release while downloading and calls out of order.


func test_second_check_update_is_false_with_error_log() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var source: UpdateSource = make_source()
	source.game_update_url = ""
	assert_true(await GameUpdateCore.check_update(source))
	assert_false(await GameUpdateCore.check_update(source))
	assert_eq(errors(), 1)


func test_release_while_downloading_ends_check_update_and_keeps_saved_files() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	var first: _FILE = make_bundle_file("bundle_a.pck", "bundle a")
	var second: _FILE = make_bundle_file("bundle_b.pck", "bundle b")
	list.bundle_files = [first, second]
	serve(list)
	downloader.clear(FILE_BASE + second.sha256)
	downloader.add_pending(FILE_BASE + second.sha256)
	start_check(make_source())
	assert_true(downloader.is_pending())
	GameUpdateCore.release()
	assert_true(check_finished)
	assert_false(check_result)
	assert_eq(downloader.cancel_count, 1)
	assert_true(LocalDataCore.file_exists("game_update/bundle_a.pck"), "saved file stays")


func test_release_while_a_popup_waits_ends_check_update() -> void:
	if not await start():
		fail_test("setup failed")
		return
	downloader.add_body(LIST_URL, PackedByteArray(), 503)
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_download_failed())
	GameUpdateCore.release()
	assert_true(check_finished)
	assert_false(check_result)
	await close_popups()
	assert_eq(restarts.count, 0, "a released popup does nothing")


func test_lifecycle() -> void:
	assert_false(GameUpdateCore.is_initialized())
	if not await start():
		fail_test("setup failed")
		return
	assert_true(GameUpdateCore.is_initialized())
	assert_false(GameUpdateCore.init(), "init while initialized")
	assert_eq(errors(), 1)
	GameUpdateCore.set_in_play(true)
	GameUpdateCore.release()
	assert_false(GameUpdateCore.is_initialized())
	assert_eq(GameUpdateCore._session, null)
	assert_eq(GameUpdateCore._node, null)
	assert_eq(GameUpdateCore._downloader, null)
	assert_eq(GameUpdateCore._downloader_override, null)
	assert_false(GameUpdateCore._store_opener.is_valid())
	assert_eq(GameUpdateCore._stall_timeout_ms, 0)
	assert_eq(GameUpdateCore._deploy_list_max_bytes, 0)
	assert_eq(GameUpdateCore._signature_max_bytes, 0)
	assert_eq(GameUpdateCore._file_max_bytes, 0)
	assert_false(GameUpdateCore._check_called)
	assert_false(GameUpdateCore._check_succeeded)
	assert_eq(GameUpdateCore._source, null)
	assert_eq(GameUpdateCore._store_url, "")
	assert_eq(GameUpdateCore._bytes_total, 0)
	assert_eq(GameUpdateCore._bytes_saved, 0)
	assert_false(GameUpdateCore._downloading)
	assert_eq(GameUpdateCore._watch_bytes, 0)
	assert_eq(GameUpdateCore._watch_time_ms, 0)
	assert_false(GameUpdateCore._stalled)
	assert_eq(GameUpdateCore._downloaded_data, null)
	assert_eq(GameUpdateCore._downloaded_translations.size(), 0)
	assert_eq(GameUpdateCore._downloaded_bundles.size(), 0)
	assert_false(GameUpdateCore._in_play)
	assert_false(GameUpdateCore._data_update_pending)
	assert_false(GameUpdateCore._update_popup_open)
	assert_eq(GameUpdateCore._popup_serial, 0)
	assert_eq(GameUpdateCore._waiters.size(), 0)
	assert_null((Engine.get_main_loop() as SceneTree).root.get_node_or_null(TAG), "core node left the tree")
	GameUpdateCoreDev.set_downloader(downloader)
	assert_true(GameUpdateCore.init(), "init again after release")
	assert_false(GameUpdateCore._in_play)


func test_core_node_destroyed_without_release_cleans_up() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var node: Node = GameUpdateCore._node
	node.get_parent().remove_child(node)
	assert_false(GameUpdateCore.is_initialized())
	assert_eq(EventCore.count_subscriptions(node), 0)
	node.free()
	await UnitTestCore.wait_frames(2)


func test_operations_after_release_log_errors() -> void:
	if not await start():
		fail_test("setup failed")
		return
	GameUpdateCore.release()
	assert_eq(GameUpdateCore.bytes_total(), 0)
	assert_eq(GameUpdateCore.bytes_done(), 0)
	assert_null(GameUpdateCore.downloaded_data())
	assert_eq(GameUpdateCore.downloaded_translations().size(), 0)
	assert_eq(GameUpdateCore.downloaded_bundles().size(), 0)
	GameUpdateCore.set_in_play(true)
	assert_false(await GameUpdateCore.check_update(make_source()))
	assert_eq(errors(), 7)


func test_queries_before_check_update_succeeds_log_errors() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_null(GameUpdateCore.downloaded_data())
	assert_eq(GameUpdateCore.downloaded_translations().size(), 0)
	assert_eq(GameUpdateCore.downloaded_bundles().size(), 0)
	assert_eq(GameUpdateCore.bytes_total(), 0)
	assert_eq(GameUpdateCore.bytes_done(), 0)
	assert_eq(errors(), 3)


func test_set_downloader_after_init_is_ignored() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var other: _DOWNLOADER = _DOWNLOADER.new()
	GameUpdateCoreDev.set_downloader(other)
	assert_eq(errors(), 1)
	serve(make_list())
	assert_true(await GameUpdateCore.check_update(make_source()))
	assert_eq(other.calls.size(), 0)
	assert_eq(downloader.count_calls(LIST_URL), 1)
