extends "res://core/notice_core/tests/support/notice_test_case.gd"
## `wait_maintenance_clear` and the maintenance popup.


func test_maintenance_popup_until_a_fetch_says_no_maintenance() -> void:
	if not await start():
		fail_test("setup failed")
		return
	respond([], true)
	respond([], false)
	var waiting: Running = start_wait()
	await pump()
	assert_false(waiting.done)
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_true(popup_texts().has(LocalizationCore.get_text(ReservedString.notice_maintenance())))
	assert_true(popup_texts().has(LocalizationCore.get_text(ReservedString.notice_retry())))
	assert_true(await press(ReservedString.notice_retry()))
	await pump()
	assert_true(waiting.done)
	assert_eq(request_count(), 2)
	assert_eq(UICore.get_open_popup_count(), 0)


func test_popup_closed_by_close_all_popups_fetches_again() -> void:
	if not await start():
		fail_test("setup failed")
		return
	respond([], true)
	respond([], true)
	respond([], false)
	var waiting: Running = start_wait()
	await pump()
	assert_eq(UICore.get_open_popup_count(), 1)
	UICore.close_all_popups()
	await pump()
	assert_false(waiting.done)
	assert_eq(request_count(), 2, "fetch again after the close")
	assert_eq(UICore.get_open_popup_count(), 1, "still in maintenance")
	assert_true(await press(ReservedString.notice_retry()))
	await pump()
	assert_true(waiting.done)
	assert_eq(request_count(), 3)


func test_failed_fetch_returns_without_popup() -> void:
	if not await start():
		fail_test("setup failed")
		return
	respond_failure()
	await NoticeCore.wait_maintenance_clear()
	check_network_logs()
	await pump()
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_eq(request_count(), 1)


func test_popup_text_comes_from_the_first_active_maintenance_notice() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var first: CoreContract.Notice = make_notice(7, MAINTENANCE, SERVER_TIME - 10000, SERVER_TIME + 10000)
	var second: CoreContract.Notice = make_notice(8, MAINTENANCE, SERVER_TIME - 10000, SERVER_TIME + 20000)
	var after_end: int = first.end_at + REACH_MARGIN_MS
	var ended: CoreContract.Notice = make_notice(7, MAINTENANCE, SERVER_TIME - 10000, SERVER_TIME + 10000)
	respond([first, second], true)
	respond([ended], true, after_end)
	respond([ended], false, after_end)
	var waiting: Running = start_wait()
	await pump()
	var args: FormatArgs = FormatArgs.new()
	args.set_int("end_at", first.end_at)
	var until: String = LocalizationCore.format(ReservedString.notice_maintenance_until(), args)
	var plain: String = LocalizationCore.get_text(ReservedString.notice_maintenance())
	var extra: String = first.title + "\n" + first.body
	var texts: PackedStringArray = popup_texts()
	assert_true(texts.has(until), "body is [notice_maintenance_until] with the first notice's end_at")
	assert_true(texts.has(extra), "extra text is the first notice's title and body")
	assert_false(texts.has(plain))
	assert_true(await press(ReservedString.notice_retry()))
	await pump()
	assert_false(waiting.done)
	texts = popup_texts()
	assert_true(texts.has(plain), "at end_at + reachMarginMs the body is [notice_maintenance]")
	assert_false(texts.has(until))
	assert_false(texts.has(extra), "no extra text")
	for text: String in texts:
		assert_false(text.contains(first.title), "no notice text in the extra text")
	# All buttons share one last click time; a tap within the interval is dropped.
	await advance(CLICK_INTERVAL_MS)
	assert_true(await press(ReservedString.notice_retry()))
	await pump()
	assert_true(waiting.done)
	assert_eq(request_count(), 3)


func test_popup_that_does_not_open_logs_and_fetches_again_after_the_retry_time() -> void:
	if not await start():
		fail_test("setup failed")
		return
	# `UICore` initialized again without `prepare`: `open_system_popup` fails.
	UICore.release()
	assert_true(UICore.init())
	respond([], true)
	respond([], false)
	var waiting: Running = start_wait()
	await pump()
	assert_eq(UnitTestCore.check_logs("error", "UICore"), 1, "open_system_popup before prepare")
	assert_eq(errors(), 1, "the maintenance popup did not open")
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_eq(request_count(), 1)
	await advance(MAINTENANCE_RETRY_MS - 1)
	assert_false(waiting.done, "maintenanceRetryMs - 1")
	assert_eq(request_count(), 1, "no fetch before maintenanceRetryMs")
	await advance(1)
	assert_eq(request_count(), 2, "fetch again at maintenanceRetryMs")
	assert_true(waiting.done, "returns after a fetch says no maintenance")
	assert_eq(errors(), 0)
	assert_eq(UnitTestCore.check_logs("error", "UICore"), 0)
