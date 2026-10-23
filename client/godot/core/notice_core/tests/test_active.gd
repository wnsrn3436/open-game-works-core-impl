extends "res://core/notice_core/tests/support/notice_test_case.gd"
## Active notices and `list_active`.


func test_active_from_start_reach_until_end_reach() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var start_at: int = SERVER_TIME + 10000
	var end_at: int = SERVER_TIME + 30000
	assert_true(await fetch_with([make_notice(1, NOTICE, start_at, end_at)]))
	assert_eq(active_ids(NOTICE).size(), 0)
	await advance(start_at + REACH_MARGIN_MS - 1 - SERVER_TIME)
	assert_eq(active_ids(NOTICE).size(), 0, "start_at + reachMarginMs - 1")
	await advance(1)
	assert_eq(active_ids(NOTICE), PackedInt64Array([1]), "start_at + reachMarginMs")
	await advance(end_at - start_at - 1)
	assert_eq(active_ids(NOTICE), PackedInt64Array([1]), "end_at + reachMarginMs - 1")
	await advance(1)
	assert_eq(active_ids(NOTICE).size(), 0, "end_at + reachMarginMs")


func test_list_active_filters_by_kind_in_response_order() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var later: CoreContract.Notice = make_notice(5, NOTICE, SERVER_TIME + 3600000, SERVER_TIME + 7200000)
	var ended: CoreContract.Notice = make_notice(6, NOTICE, SERVER_TIME - 7200000, SERVER_TIME - 3600000)
	assert_true(await fetch_with([active_notice(3), active_notice(10, BANNER), later, active_notice(1),
			active_notice(20, MAINTENANCE), ended, active_notice(11, BANNER)]))
	assert_eq(active_ids(NOTICE), PackedInt64Array([3, 1]))
	assert_eq(active_ids(BANNER), PackedInt64Array([10, 11]))
	assert_eq(active_ids(MAINTENANCE), PackedInt64Array([20]))


func test_list_active_fills_only_the_buffer_size() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_true(await fetch_with([active_notice(1), active_notice(2)]))
	var buffer: Array[CoreContract.Notice] = [null]
	assert_eq(NoticeCore.list_active(NOTICE, buffer), 1)
	assert_eq(buffer.size(), 1, "the buffer size stays")
	assert_eq(buffer[0].id, 1)
	assert_eq(errors(), 1)


func test_list_active_of_an_unknown_kind_is_zero() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_true(await fetch_with([active_notice(1)]))
	var buffer: Array[CoreContract.Notice] = [null, null]
	assert_eq(NoticeCore.list_active(CoreContract.NoticeKind.NOTICE_KIND_UNSPECIFIED, buffer), 0)
	assert_eq(errors(), 1)


func test_get_notice_of_an_unknown_id_warns() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_true(await fetch_with([active_notice(1)]))
	assert_eq(NoticeCore.get_notice(1).title, "title 1")
	assert_null(NoticeCore.get_notice(2))
	assert_eq(warns(), 1)
