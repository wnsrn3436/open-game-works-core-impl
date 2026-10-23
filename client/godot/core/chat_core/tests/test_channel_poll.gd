extends "res://core/chat_core/tests/support/chat_test_case.gd"
## The channel list polling: `start`, `poll_after_ms`, the failure retry, background, `refresh_channels`,
## `CHILD_RESTRICTED` and `release`.

const POLL_MS: int = 5000

## The `refresh_channels` an event subscriber started.
var chained: Run = null


func _refresh_once(_event: ChatChannelsChangedEvent) -> void:
	if chained == null:
		chained = refresh_in_background()


func test_the_next_request_goes_after_poll_after_ms_and_after_a_failure_after_the_failure_retry() -> void:
	await start_chat([], false)
	await start_with([], POLL_MS)
	assert_eq(request_count(GET_CHANNELS), 1, "start sends GetChatChannels")
	await pass_time(POLL_MS - 1)
	assert_eq(request_count(GET_CHANNELS), 1, "nothing before poll_after_ms")
	add_error(GET_CHANNELS, CoreContract.CoreError.CORE_ERROR_INTERNAL)
	await pass_time(1)
	assert_eq(request_count(GET_CHANNELS), 2, "the poll goes at poll_after_ms")
	assert_eq(network_errors(), 1)
	add_channels([], POLL_MS)
	await pass_time(FAILURE_RETRY_MS - 1)
	assert_eq(request_count(GET_CHANNELS), 2, "nothing before the failure retry")
	await pass_time(1)
	assert_eq(request_count(GET_CHANNELS), 3, "the poll goes at ChatCore.failureRetryMs after the failure")
	assert_eq(request_count(GET_MESSAGES), 0)


func test_no_request_in_the_background_and_one_right_after_the_return() -> void:
	await start_chat([], false)
	await start_with([], POLL_MS)
	var real_before: int = TimeCore.get_real_time()
	add_channels([], POLL_MS)
	add_ok(RESYNC)
	UnitTestCore.advance_clock(POLL_MS * 4, true)
	assert_eq(TimeCore.get_real_time(), real_before, "the background adds no real elapsed time")
	await settle()
	assert_eq(request_count(GET_CHANNELS), 2, "one request right after the return, none for the background time")
	await pass_time(POLL_MS - 1)
	assert_eq(request_count(GET_CHANNELS), 2, "the next poll waits poll_after_ms from the return")
	add_channels([], POLL_MS)
	await pass_time(1)
	assert_eq(request_count(GET_CHANNELS), 3)


func test_a_watched_channel_polls_right_after_the_return() -> void:
	await start_chat([], false)
	await start_with([], LONG_MS)
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([1]), 1, 1, POLL_MS))
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	await settle()
	await pass_time(POLL_MS - 1)
	assert_eq(message_requests().size(), 1, "nothing before poll_after_ms")
	var real_before: int = TimeCore.get_real_time()
	add_channels([], LONG_MS)
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([2]), 2, 1, LONG_MS))
	add_ok(RESYNC)
	UnitTestCore.advance_clock(POLL_MS * 4, true)
	await settle()
	assert_eq(TimeCore.get_real_time(), real_before, "the poll wait of 1 ms is not over")
	assert_eq(message_requests().size(), 2, "the watched channel polls right after the return")
	assert_eq(last_message_request().after_seq, 1)
	assert_eq(cached_seqs(DIRECT, FRIEND_ID), PackedInt64Array([1, 2]))


func test_a_refresh_channels_of_an_event_subscriber_waits_for_its_own_request() -> void:
	chained = null
	await start_chat([])
	assert_true(EventCore.subscribe(ChatChannelsChangedEvent, _refresh_once))
	add_channels([entry(DIRECT, FRIEND_ID, 1, 1)])
	UnitTestCore.add_pending(GET_CHANNELS)
	assert_true(await ChatCore.refresh_channels())
	await settle()
	assert_not_null(chained, "the list changed and the subscriber called refresh_channels")
	assert_eq(request_count(GET_CHANNELS), 3, "the subscriber's refresh_channels sent a request")
	assert_false(chained.done, "it waits for the response of its own request")
	assert_true(UnitTestCore.release_pending(GET_CHANNELS, NetworkCore.TransferResult.DONE, 200, error_bytes(CoreContract.CoreError.CORE_ERROR_INTERNAL)))
	assert_false(await wait_run(chained), "the result of its own request")
	assert_eq(network_errors(), 1)


func test_two_refresh_channels_at_once_are_one_request() -> void:
	await start_chat([])
	UnitTestCore.add_pending(GET_CHANNELS)
	var first: Run = refresh_in_background()
	var second: Run = refresh_in_background()
	await settle()
	assert_eq(request_count(GET_CHANNELS), 2, "refresh_channels does not wait for poll_after_ms and sends once")
	assert_true(UnitTestCore.release_pending(GET_CHANNELS, NetworkCore.TransferResult.DONE, 200, channels_bytes([entry(DIRECT, FRIEND_ID, 1, 1)])))
	assert_true(await wait_run(first))
	assert_true(await wait_run(second))
	assert_eq(request_count(GET_CHANNELS), 2)
	assert_eq(ChatCore.get_channel_count(), 1)
	assert_eq(channel_events, 1, "the list changed once")


func test_refresh_channels_before_start_is_false_without_a_request() -> void:
	await start_chat([], false)
	assert_false(await ChatCore.refresh_channels())
	assert_eq(request_count(GET_CHANNELS), 0)


func test_an_unchanged_list_publishes_no_event() -> void:
	var entries: Array[CoreContract.ChatChannelEntry] = [entry(DIRECT, FRIEND_ID, 2, 2)]
	await start_chat(entries)
	assert_eq(channel_events, 1)
	add_channels([entry(DIRECT, FRIEND_ID, 2, 2)])
	assert_true(await ChatCore.refresh_channels())
	assert_eq(channel_events, 1, "same list")
	add_channels([entry(DIRECT, FRIEND_ID, 3, 2)])
	assert_true(await ChatCore.refresh_channels())
	assert_eq(channel_events, 2, "one field differs")
	assert_eq(ChatCore.get_channel(0).last_seq, 3)


func test_child_restricted_stops_every_request_until_release_init_and_start() -> void:
	await start_chat([], false)
	await start_with([entry(GUILD, GUILD_ID, 5, 5)], POLL_MS)
	add_messages(messages(GUILD, GUILD_ID, PackedInt64Array([4, 5]), 5, 4))
	assert_true(ChatCore.watch_channel(GUILD, 0))
	await settle()
	assert_eq(channel_events, 1)
	add_error(GET_CHANNELS, CoreContract.CoreError.CORE_ERROR_CHILD_RESTRICTED)
	await pass_time(POLL_MS)
	assert_eq(network_errors(), 1)
	assert_eq(ChatCore.get_channel_count(), 0)
	assert_eq(channel_events, 2, "the list became empty")
	add_ok(RESYNC)
	UnitTestCore.advance_clock(1000, true)
	await settle()
	assert_eq(request_count(RESYNC), 1)
	var received: int = UnitTestCore.received_requests().size()
	await pass_time(LONG_MS)
	assert_false(await ChatCore.refresh_channels())
	assert_false(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	assert_false(await ChatCore.load_older(GUILD, 0))
	var sent: ChatSendResult = await ChatCore.send_message(GUILD, 0, TEXT, "hello")
	assert_false(sent.ok)
	assert_eq(sent.error_code, CoreContract.CoreError.CORE_ERROR_CHILD_RESTRICTED)
	assert_null(sent.message)
	await settle()
	assert_eq(UnitTestCore.received_requests().size(), received, "no request after CHILD_RESTRICTED")
	assert_eq(chat_errors(), 0)
	assert_eq(chat_warns(), 0, "the refused calls leave no log")
	await restart_chat([])
	assert_eq(request_count(GET_CHANNELS), 3, "GetChatChannels goes again after release, init and start")
	# The resync makes BadgeCore judge the core test data badges with an `ItemAtLeast` requirement, which has no judge
	# hook in the ChatCore core tests.
	assert_eq(UnitTestCore.check_logs("error", "RequirementCore"), 1)


func test_release_ends_the_operations_on_the_way_and_no_request_follows() -> void:
	await start_chat([])
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([8, 9]), 9, 8, POLL_MS))
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	await settle()
	UnitTestCore.add_pending(GET_MESSAGES)
	var older: Run = older_in_background(DIRECT, FRIEND_ID)
	var sent: Run = send_in_background(DIRECT, FRIEND_ID, "hello")
	var refreshed: Run = refresh_in_background()
	await settle()
	assert_false(older.done)
	assert_false(sent.done)
	assert_false(refreshed.done)
	var received: int = UnitTestCore.received_requests().size()
	ChatCore.release()
	assert_false(await wait_run(older))
	assert_false(await wait_run(sent))
	assert_false(sent.result.ok)
	assert_null(sent.result.message)
	assert_false(await wait_run(refreshed))
	# Past the poll wait of the watched channel, within NetworkCore.requestTimeoutMs of the held request.
	await pass_time(POLL_MS + 1000)
	assert_eq(UnitTestCore.received_requests().size(), received, "no request after release")
