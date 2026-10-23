extends "res://core/notice_core/tests/support/notice_test_case.gd"
## The `[notice_badge]` items of the active unread `Notice` kind notices.


func test_badge_items_follow_active_unread_notices() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var ending: CoreContract.Notice = make_notice(2, NOTICE, SERVER_TIME - 3600000, SERVER_TIME + 5000)
	var starting: CoreContract.Notice = make_notice(3, NOTICE, SERVER_TIME + 5000, SERVER_TIME + 3600000)
	assert_true(await fetch_with([active_notice(1), ending, starting, active_notice(4, BANNER),
			active_notice(5, MAINTENANCE)]))
	await pump()
	assert_eq(badge_item(1), 1, "active unread notice")
	assert_eq(badge_item(2), 1, "active unread notice")
	assert_eq(badge_item(3), 0, "not started")
	assert_eq(badge_item(4), 0, "Banner has no item")
	assert_eq(badge_item(5), 0, "Maintenance has no item")
	NoticeCore.mark_read(1)
	await pump()
	assert_eq(badge_item(1), 0, "mark_read removes the item")
	assert_true(NoticeCore.is_read(1))
	await advance(5000 + REACH_MARGIN_MS - 1)
	assert_eq(badge_item(2), 1, "end_at + reachMarginMs - 1")
	assert_eq(badge_item(3), 0, "start_at + reachMarginMs - 1")
	await advance(1)
	assert_eq(badge_item(2), 0, "the end_at reach frame removes the item")
	assert_eq(badge_item(3), 1, "the start_at reach frame adds the item")
	assert_eq(badge_item(4), 0)
	assert_eq(badge_item(5), 0)


func test_notice_left_out_of_the_list_loses_its_item() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_true(await fetch_with([active_notice(1), active_notice(2)]))
	await pump()
	assert_eq(badge_item(1), 1)
	assert_true(await fetch_with([active_notice(2)]))
	await pump()
	assert_eq(badge_item(1), 0)
	assert_eq(badge_item(2), 1)


func test_mark_read_of_a_notice_out_of_the_cache_warns_and_saves_nothing() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_true(await fetch_with([active_notice(1)]))
	NoticeCore.mark_read(9)
	assert_eq(warns(), 1)
	assert_false(NoticeCore.is_read(9))
	assert_eq(LocalDataCore.get_array_int(LocalDataCore.FileKind.DEVICE, "NoticeCore.read_ids").size(), 0)


func test_notice_badge_that_is_not_a_badge_row_logs_once_until_release() -> void:
	var no_badge_rows: Dictionary[String, PackedByteArray] = {"badge.bin": PackedByteArray()}
	if not await start(null, no_badge_rows):
		fail_test("setup failed")
		return
	assert_false(GameData.BadgeTable.has_row(ReservedId.notice_badge()), "the data has no [notice_badge] row")
	assert_true(await fetch_with([active_notice(1), active_notice(2)]))
	await pump()
	assert_eq(errors(), 1, "one error for the first badge sync")
	NoticeCore.mark_read(1)
	assert_true(await fetch_with([active_notice(2), active_notice(3)]))
	NoticeCore.mark_read(2)
	await pump()
	assert_eq(errors(), 0, "no more errors before release")
	assert_true(NoticeCore.is_read(2))
	assert_eq(UnitTestCore.check_logs("error", "BadgeCore"), 0, "no BadgeCore call for a badge that is not a row")
	NoticeCore.release()
	assert_true(NoticeCore.init())
	assert_true(await fetch_with([active_notice(3)]))
	await pump()
	assert_eq(errors(), 1, "one error again after release and init")
	assert_eq(UnitTestCore.check_logs("error", "BadgeCore"), 0)
