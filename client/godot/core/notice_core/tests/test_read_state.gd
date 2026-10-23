extends "res://core/notice_core/tests/support/notice_test_case.gd"
## The read state in the `device` file.

const READ_IDS: String = "NoticeCore.read_ids"


func test_read_id_stays_after_release_and_init() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_true(await fetch_with([active_notice(1), active_notice(2)]))
	NoticeCore.mark_read(1)
	NoticeCore.mark_read(1)
	assert_eq(LocalDataCore.get_array_int(LocalDataCore.FileKind.DEVICE, READ_IDS), PackedInt64Array([1]))
	NoticeCore.release()
	assert_true(NoticeCore.init())
	assert_true(NoticeCore.is_read(1), "read before any fetch of the new init")
	assert_false(NoticeCore.is_read(2))


func test_read_id_left_out_of_the_received_list_is_removed() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_true(await fetch_with([active_notice(1), active_notice(2)]))
	NoticeCore.mark_read(1)
	NoticeCore.mark_read(2)
	assert_true(await fetch_with([active_notice(2)]))
	assert_false(NoticeCore.is_read(1))
	assert_true(NoticeCore.is_read(2))
	assert_eq(LocalDataCore.get_array_int(LocalDataCore.FileKind.DEVICE, READ_IDS), PackedInt64Array([2]))


func test_failed_fetch_keeps_the_read_ids() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_true(await fetch_with([active_notice(1)]))
	NoticeCore.mark_read(1)
	respond_failure()
	assert_false(await NoticeCore.fetch(true))
	check_network_logs()
	assert_true(NoticeCore.is_read(1))
