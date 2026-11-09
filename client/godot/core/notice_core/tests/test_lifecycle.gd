extends "res://core/notice_core/tests/support/notice_test_case.gd"
## Lifecycle, `release` while operations run and calls out of order.


func test_lifecycle() -> void:
	assert_false(NoticeCore.is_initialized())
	var downloader: _HANGING = _HANGING.new()
	if not await start(downloader):
		fail_test("setup failed")
		return
	assert_true(NoticeCore.is_initialized())
	assert_false(NoticeCore.init(), "init while initialized")
	assert_eq(errors(), 1)
	var with_image: CoreContract.Notice = active_notice(1)
	with_image.image_url = "https://images.example.com/a.png"
	assert_true(await fetch_with([with_image], true))
	NoticeCore.mark_read(1)
	var loading: Running = start_load(1)
	await pump()
	NoticeCore.release()
	assert_true(loading.done)
	assert_false(NoticeCore.is_initialized())
	assert_eq(NoticeCore._session, null)
	assert_eq(NoticeCore._node, null)
	assert_eq(NoticeCore._downloader, null)
	assert_eq(NoticeCore._downloader_override, null)
	assert_false(NoticeCore._after_frame_call.is_valid())
	assert_false(NoticeCore._after_frame_scheduled)
	assert_eq(NoticeCore._cache_ttl_ms, 0)
	assert_eq(NoticeCore._maintenance_retry_ms, 0)
	assert_eq(NoticeCore._image_max_bytes, 0)
	assert_eq(NoticeCore._image_timeout_ms, 0)
	assert_false(NoticeCore._maintenance)
	assert_eq(NoticeCore._notices.size(), 0)
	assert_eq(NoticeCore._reach.size(), 0)
	assert_false(NoticeCore._has_success)
	assert_eq(NoticeCore._success_real_ms, 0)
	assert_eq(NoticeCore._background_ms, 0)
	assert_eq(NoticeCore._fetch_waiter, null)
	assert_eq(NoticeCore._read_ids.size(), 0)
	assert_false(NoticeCore._read_loaded)
	assert_false(NoticeCore._badge_dirty)
	assert_false(NoticeCore._badge_error_logged)
	assert_eq(NoticeCore._popup_waiter, null)
	assert_eq(NoticeCore._retry_waiter, null)
	assert_eq(NoticeCore._retry_deadline_ms, 0)
	assert_false(NoticeCore._retry_due)
	assert_eq(NoticeCore._images.size(), 0)
	assert_eq(NoticeCore._image_urls.size(), 0)
	assert_eq(NoticeCore._image_load, null)
	assert_eq(NoticeCore._image_started_ms, 0)
	assert_null((Engine.get_main_loop() as SceneTree).root.get_node_or_null(TAG), "core node left the tree")
	assert_eq(LocalDataCore.get_array_int(LocalDataCore.FileKind.DEVICE, "NoticeCore.read_ids"),
			PackedInt64Array([1]), "read_ids stay")
	downloader.finish()
	await pump()
	assert_true(NoticeCore.init(), "init again after release")
	assert_false(NoticeCore.is_maintenance())
	respond([])
	assert_true(await NoticeCore.fetch(false), "a new init has no cache time")
	assert_eq(request_count(), 2)


func test_release_ends_fetch_load_image_and_wait_maintenance_clear() -> void:
	var downloader: _HANGING = _HANGING.new()
	if not await start(downloader):
		fail_test("setup failed")
		return
	var with_image: CoreContract.Notice = active_notice(1, BANNER)
	with_image.image_url = "https://images.example.com/a.png"
	assert_true(await fetch_with([with_image]))
	UnitTestCore.add_pending(GET_NOTICES)
	var fetching: Running = start_fetch(true)
	var waiting: Running = start_wait()
	var loading: Running = start_load(1)
	await pump()
	assert_false(fetching.done)
	assert_false(waiting.done)
	assert_false(loading.done)
	NoticeCore.release()
	assert_true(fetching.done)
	assert_false(fetching.ok)
	assert_true(waiting.done)
	assert_true(loading.done)
	assert_null(loading.texture)
	assert_eq(downloader.cancel_count, 1)
	assert_true(UnitTestCore.release_pending(GET_NOTICES, NetworkCore.TransferResult.DONE, 200, response_bytes([])))
	downloader.finish()
	await pump()


func test_release_while_the_maintenance_popup_is_open_ends_the_wait() -> void:
	if not await start():
		fail_test("setup failed")
		return
	respond([], true)
	var waiting: Running = start_wait()
	await pump()
	assert_eq(UICore.get_open_popup_count(), 1)
	NoticeCore.release()
	assert_true(waiting.done)
	assert_eq(UICore.get_open_popup_count(), 1, "release does not close the maintenance popup")
	UICore.close_all_popups()
	await pump()
	assert_eq(request_count(), 1, "a released popup fetches nothing")


func test_core_node_destroyed_without_release_cleans_up() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var node: Node = NoticeCore._node
	node.get_parent().remove_child(node)
	assert_false(NoticeCore.is_initialized())
	assert_eq(EventCore.count_subscriptions(node), 0)
	node.free()
	await pump()


func test_operations_before_init_log_errors() -> void:
	assert_true(LogCore.init())
	var buffer: Array[CoreContract.Notice] = [null]
	assert_false(await NoticeCore.fetch(true))
	assert_false(NoticeCore.is_maintenance())
	assert_eq(NoticeCore.list_active(NOTICE, buffer), 0)
	assert_null(NoticeCore.get_notice(1))
	assert_false(NoticeCore.is_read(1))
	NoticeCore.mark_read(1)
	assert_null(await NoticeCore.load_image(1))
	await NoticeCore.wait_maintenance_clear()
	assert_eq(errors(), 8)


func test_set_image_downloader_after_init_is_ignored() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var downloader: _HANGING = _HANGING.new()
	NoticeCoreDev.set_image_downloader(downloader)
	assert_eq(errors(), 1)
	assert_eq(NoticeCore._downloader_override, null)


func test_release_before_init_drops_the_image_downloader() -> void:
	# `LogCore` before `init` writes only to the console, so it is initialized for the logs of `release` to be seen.
	assert_true(LogCore.init())
	var dropped: _HANGING = _HANGING.new()
	NoticeCoreDev.set_image_downloader(dropped)
	assert_eq(NoticeCore._downloader_override, dropped)
	NoticeCore.release()
	assert_false(NoticeCore.is_initialized())
	assert_eq(NoticeCore._downloader_override, null)
	assert_eq(errors(), 0, "release before init leaves no log")
	assert_eq(warns(), 0, "release before init leaves no log")


func test_downloader_dropped_before_init_is_not_used_by_a_later_init() -> void:
	# `LogCore` is not initialized before `start`, so that the log collector of `UnitTestCore` stays registered for the whole test.
	var dropped: _HANGING = _HANGING.new()
	NoticeCoreDev.set_image_downloader(dropped)
	NoticeCore.release()
	assert_eq(NoticeCore._downloader_override, null)
	if not await start():
		fail_test("setup failed")
		return
	assert_ne(NoticeCore._downloader, dropped)
	var base: String = await UnitTestCore.start_http_server()
	assert_false(base.is_empty())
	if base.is_empty():
		return
	var image: Image = Image.create_empty(2, 2, false, Image.FORMAT_RGBA8)
	image.fill(Color.RED)
	var no_headers: Array[PackedStringArray] = []
	assert_true(await UnitTestCore.add_http_response(base, "/a.png", 200, no_headers, image.save_png_to_buffer()))
	var with_image: CoreContract.Notice = active_notice(1, BANNER)
	with_image.image_url = base + "/a.png"
	assert_true(await fetch_with([with_image]))
	assert_not_null(await NoticeCore.load_image(1), "the default downloader loads the image")
	assert_eq(dropped.urls.size(), 0, "the dropped downloader gets no download")
