extends "res://core/chat_core/tests/support/chat_test_case.gd"
## `has_older` and `load_older`.

## The `load_older` an event subscriber started.
var chained: Run = null


func _load_older_once(event: ChatMessagesChangedEvent) -> void:
	if chained == null and event.change == ChatCore.ChatMessagesChange.PREPENDED:
		chained = older_in_background(event.channel_kind, event.channel_key)


func watch_with(seqs: PackedInt64Array, last_seq: int, first_seq: int) -> void:
	add_messages(messages(DIRECT, FRIEND_ID, seqs, last_seq, first_seq))
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	await settle()


func test_load_older_goes_before_the_old_message_cursor_and_prepends_only_smaller_seqs() -> void:
	await start_chat([])
	await watch_with(PackedInt64Array([5, 6, 7]), 7, 5)
	assert_true(ChatCore.has_older(DIRECT, FRIEND_ID))
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([4, 3, 5, 6]), 7, 3))
	assert_true(await ChatCore.load_older(DIRECT, FRIEND_ID))
	var request: CoreContract.GetChatMessagesRequest = last_message_request()
	assert_eq(PackedInt64Array([request.after_seq, request.before_seq, request.after_delete_seq]), PackedInt64Array([0, 5, 0]))
	assert_eq(cached_seqs(DIRECT, FRIEND_ID), PackedInt64Array([3, 4, 5, 6, 7]))
	assert_eq(changes, PackedStringArray(["501 Reset 3", "501 Prepended 2"]))
	assert_true(ChatCore.has_older(DIRECT, FRIEND_ID), "the old message cursor is 3")


func test_two_load_older_at_once_are_one_request() -> void:
	await start_chat([])
	await watch_with(PackedInt64Array([5, 6]), 6, 5)
	UnitTestCore.add_pending(GET_MESSAGES)
	var first: Run = older_in_background(DIRECT, FRIEND_ID)
	var second: Run = older_in_background(DIRECT, FRIEND_ID)
	await settle()
	assert_eq(message_requests().size(), 2)
	assert_true(release_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([1, 2, 3, 4]), 6, 1)))
	assert_true(await wait_run(first))
	assert_true(await wait_run(second))
	assert_eq(message_requests().size(), 2, "one load_older request")
	assert_eq(cached_seqs(DIRECT, FRIEND_ID), PackedInt64Array([1, 2, 3, 4, 5, 6]))


func test_an_old_message_cursor_of_1_or_0_has_no_older_and_load_older_is_true_without_a_request() -> void:
	await start_chat([])
	await watch_with(PackedInt64Array([1, 2]), 2, 1)
	assert_false(ChatCore.has_older(DIRECT, FRIEND_ID))
	assert_true(await ChatCore.load_older(DIRECT, FRIEND_ID))
	assert_eq(message_requests().size(), 1)
	add_messages(messages(WORLD, WORLD_NUMBER, PackedInt64Array(), 0, 0))
	assert_true(ChatCore.watch_channel(WORLD, WORLD_NUMBER))
	await settle()
	assert_false(ChatCore.has_older(WORLD, WORLD_NUMBER))
	assert_true(await ChatCore.load_older(WORLD, WORLD_NUMBER))
	assert_eq(message_requests().size(), 2)


func test_a_failed_load_older_keeps_the_cache_and_cursors() -> void:
	await start_chat([])
	await watch_with(PackedInt64Array([5, 6]), 6, 5)
	add_error(GET_MESSAGES, CoreContract.CoreError.CORE_ERROR_INTERNAL)
	assert_false(await ChatCore.load_older(DIRECT, FRIEND_ID))
	assert_eq(network_errors(), 1)
	assert_eq(cached_seqs(DIRECT, FRIEND_ID), PackedInt64Array([5, 6]))
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([4]), 6, 4))
	assert_true(await ChatCore.load_older(DIRECT, FRIEND_ID))
	assert_eq(last_message_request().before_seq, 5)


func test_a_guild_response_of_another_guild_is_dropped() -> void:
	await start_chat([])
	add_messages(messages(GUILD, GUILD_ID, PackedInt64Array([5, 6]), 6, 5))
	assert_true(ChatCore.watch_channel(GUILD, 0))
	await settle()
	add_messages(messages(GUILD, OTHER_GUILD_ID, PackedInt64Array([3, 4]), 6, 3))
	assert_false(await ChatCore.load_older(GUILD, 0))
	assert_eq(cached_seqs(GUILD, 0), PackedInt64Array([5, 6]))
	assert_true(ChatCore.has_older(GUILD, 0), "the old message cursor stays 5")


func test_a_load_older_of_an_event_subscriber_waits_for_its_own_request() -> void:
	chained = null
	await start_chat([])
	await watch_with(PackedInt64Array([5, 6]), 6, 5)
	assert_true(EventCore.subscribe(ChatMessagesChangedEvent, _load_older_once))
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([3, 4]), 6, 3))
	UnitTestCore.add_pending(GET_MESSAGES)
	assert_true(await ChatCore.load_older(DIRECT, FRIEND_ID))
	await settle()
	assert_not_null(chained, "the subscriber called load_older on Prepended")
	assert_eq(message_requests().size(), 3, "the subscriber's load_older sent a request")
	assert_eq(last_message_request().before_seq, 3)
	assert_false(chained.done, "it waits for the response of its own request")
	assert_true(UnitTestCore.release_pending(GET_MESSAGES, NetworkCore.TransferResult.DONE, 200, error_bytes(CoreContract.CoreError.CORE_ERROR_INTERNAL)))
	assert_false(await wait_run(chained), "the result of its own request")
	assert_eq(network_errors(), 1)
	assert_eq(cached_seqs(DIRECT, FRIEND_ID), PackedInt64Array([3, 4, 5, 6]))
