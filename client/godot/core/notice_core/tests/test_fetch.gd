extends "res://core/notice_core/tests/support/notice_test_case.gd"
## `fetch`: the cache time, the shared running fetch, the foreground return fetch, the request and
## `NoticesChangedEvent`.


func test_fetch_without_force_sends_only_after_cache_ttl() -> void:
	if not await start():
		fail_test("setup failed")
		return
	respond([])
	assert_true(await NoticeCore.fetch(false), "the first fetch sends")
	assert_eq(request_count(), 1)
	assert_true(await NoticeCore.fetch(false))
	assert_eq(request_count(), 1, "no request within cacheTtlMs")
	await advance(CACHE_TTL_MS - 1)
	assert_true(await NoticeCore.fetch(false))
	assert_eq(request_count(), 1, "no request at cacheTtlMs - 1")
	await advance(1)
	respond([])
	assert_true(await NoticeCore.fetch(false))
	assert_eq(request_count(), 2, "a request at cacheTtlMs")
	respond([])
	assert_true(await NoticeCore.fetch(true))
	assert_eq(request_count(), 3, "force flag true sends within cacheTtlMs")


func test_two_fetches_at_once_send_one_request() -> void:
	if not await start():
		fail_test("setup failed")
		return
	UnitTestCore.add_pending(GET_NOTICES)
	var first: Running = start_fetch(true)
	var second: Running = start_fetch(true)
	await pump()
	assert_false(first.done)
	assert_false(second.done)
	assert_true(UnitTestCore.release_pending(GET_NOTICES, NetworkCore.TransferResult.DONE, 200,
			response_bytes([active_notice(1)])))
	await pump()
	assert_true(first.done and first.ok)
	assert_true(second.done and second.ok)
	assert_eq(request_count(), 1)


func test_foreground_return_fetch_counts_background_time() -> void:
	if not await start():
		fail_test("setup failed")
		return
	respond([])
	assert_true(await NoticeCore.fetch(true))
	var half: int = CACHE_TTL_MS / 2
	await advance(half)
	UnitTestCore.advance_clock(CACHE_TTL_MS - half - 1, true)
	await pump()
	assert_eq(request_count(), 1, "real elapsed time plus background is cacheTtlMs - 1")
	respond([])
	UnitTestCore.advance_clock(1, true)
	await pump()
	assert_eq(request_count(), 2, "real elapsed time plus background reached cacheTtlMs")


func test_get_notices_goes_without_access_token_in_the_current_language() -> void:
	if not await start():
		fail_test("setup failed")
		return
	respond([])
	assert_true(await NoticeCore.fetch(true))
	var requests: Array[UnitTestRequest] = UnitTestCore.received_requests()
	var sent: UnitTestRequest = null
	for received: UnitTestRequest in requests:
		if received.name == GET_NOTICES:
			sent = received
	assert_not_null(sent)
	if sent == null:
		return
	for line: String in sent.headers:
		assert_false(line.begins_with("Authorization:"), "no access token")
	var request: CoreContract.GetNoticesRequest = CoreContract.GetNoticesRequest.new()
	assert_true(request.decode(sent.body))
	assert_eq(request.language, LocalizationCore.get_language_code())
	assert_false(request.language.is_empty())


func test_notices_changed_event_only_for_a_changed_list() -> void:
	if not await start():
		fail_test("setup failed")
		return
	assert_true(await fetch_with([]))
	assert_eq(changed_events, 0, "an empty list after an empty cache is no change")
	var first: CoreContract.Notice = active_notice(1)
	assert_true(await fetch_with([first]))
	assert_eq(changed_events, 1, "an added notice")
	assert_true(await fetch_with([first]))
	assert_eq(changed_events, 1, "the same list")
	var edited: CoreContract.Notice = active_notice(1)
	edited.body = "edited"
	assert_true(await fetch_with([edited]))
	assert_eq(changed_events, 2, "a field of the same id")
	var second: CoreContract.Notice = active_notice(2, BANNER)
	assert_true(await fetch_with([edited, second], true))
	assert_eq(changed_events, 3, "another id set")
	assert_true(NoticeCore.is_maintenance())
	respond_failure()
	assert_false(await NoticeCore.fetch(true))
	check_network_logs()
	assert_eq(changed_events, 3, "no event for a failed fetch")
	assert_true(NoticeCore.is_maintenance(), "a failed fetch keeps the cache")
	assert_eq(NoticeCore.get_notice(1).body, "edited")
	assert_not_null(NoticeCore.get_notice(2))
	assert_eq(active_ids(BANNER), PackedInt64Array([2]))
