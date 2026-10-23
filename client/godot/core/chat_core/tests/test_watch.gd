extends "res://core/chat_core/tests/support/chat_test_case.gd"
## Watched channels: the first request, polls, deleted messages, the read seq of a watched channel, the `Guild` guild
## change and `GUILD_NOT_MEMBER`, `unwatch_channel` and the watch limit.

const POLL_MS: int = 2000


func test_the_first_request_fills_the_cache_and_the_next_poll_appends_only_new_messages() -> void:
	await start_chat([])
	var first: CoreContract.GetChatMessagesResponse = messages(DIRECT, FRIEND_ID, PackedInt64Array([7, 5, 6]), 7, 5, POLL_MS)
	first.last_delete_seq = 2
	add_messages(first)
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	await settle()
	var request: CoreContract.GetChatMessagesRequest = last_message_request()
	assert_eq(PackedInt64Array([request.after_seq, request.before_seq, request.after_delete_seq]), PackedInt64Array([0, 0, 0]), "the first request")
	assert_eq(request.channel_kind, DIRECT)
	assert_eq(request.channel_key, FRIEND_ID)
	assert_eq(cached_seqs(DIRECT, FRIEND_ID), PackedInt64Array([5, 6, 7]), "ascending seq")
	assert_eq(changes, PackedStringArray(["501 Reset 3"]))
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([6, 7, 9, 8]), 9, 5, LONG_MS))
	await pass_time(POLL_MS)
	assert_eq(message_requests().size(), 2)
	request = last_message_request()
	assert_eq(PackedInt64Array([request.after_seq, request.before_seq, request.after_delete_seq]), PackedInt64Array([7, 0, 2]), "after the cursors")
	assert_eq(cached_seqs(DIRECT, FRIEND_ID), PackedInt64Array([5, 6, 7, 8, 9]), "a seq in the cache comes once")
	assert_eq(changes, PackedStringArray(["501 Reset 3", "501 Appended 2"]))
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID), "watched already")
	assert_eq(message_requests().size(), 2)


func test_an_empty_channel_then_new_messages_come_with_after_seq_0_and_set_the_old_message_cursor() -> void:
	await start_chat([])
	add_messages(messages(WORLD, WORLD_NUMBER, PackedInt64Array(), 0, 0, POLL_MS))
	assert_true(ChatCore.watch_channel(WORLD, WORLD_NUMBER))
	await settle()
	assert_eq(changes, PackedStringArray(["3 Reset 0"]))
	assert_false(ChatCore.has_older(WORLD, WORLD_NUMBER))
	add_messages(messages(WORLD, WORLD_NUMBER, PackedInt64Array([3, 4]), 4, 3, LONG_MS))
	await pass_time(POLL_MS)
	assert_eq(last_message_request().after_seq, 0)
	assert_eq(cached_seqs(WORLD, WORLD_NUMBER), PackedInt64Array([3, 4]))
	assert_eq(changes, PackedStringArray(["3 Reset 0", "3 Appended 2"]))
	assert_true(ChatCore.has_older(WORLD, WORLD_NUMBER), "the old message cursor is first_seq 3")
	add_messages(messages(WORLD, WORLD_NUMBER, PackedInt64Array([1, 2]), 4, 1, LONG_MS))
	assert_true(await ChatCore.load_older(WORLD, WORLD_NUMBER))
	assert_eq(last_message_request().before_seq, 3)


func test_deleted_seqs_leave_the_cache_with_a_removed_event_of_that_count() -> void:
	await start_chat([])
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([1, 2, 3]), 3, 1, POLL_MS))
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	await settle()
	var poll: CoreContract.GetChatMessagesResponse = messages(DIRECT, FRIEND_ID, PackedInt64Array(), 3, 1, POLL_MS)
	poll.deleted_seqs = PackedInt64Array([2, 3, 40])
	poll.last_delete_seq = 5
	add_messages(poll)
	await pass_time(POLL_MS)
	assert_eq(cached_seqs(DIRECT, FRIEND_ID), PackedInt64Array([1]))
	assert_eq(changes, PackedStringArray(["501 Reset 3", "501 Removed 2"]))
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array(), 3, 1, LONG_MS))
	await pass_time(POLL_MS)
	assert_eq(last_message_request().after_delete_seq, 5)


func test_a_watched_channel_that_receives_messages_has_no_unread() -> void:
	var saved: PackedStringArray = PackedStringArray(["CHAT_CHANNEL_KIND_DIRECT:501=2"])
	await start_chat([entry(DIRECT, FRIEND_ID, 5, 5)], true, true, saved)
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 3)
	assert_eq(badge_item(FRIEND_ID), 3)
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([4, 5]), 5, 4))
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	await settle()
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 0)
	assert_eq(badge_item(FRIEND_ID), 0)


func test_a_guild_change_resets_and_sends_the_first_request_and_guild_not_member_empties_the_cache() -> void:
	await start_chat([entry(GUILD, GUILD_ID, 2, 2)])
	add_messages(messages(GUILD, GUILD_ID, PackedInt64Array([1, 2]), 2, 1, POLL_MS))
	assert_true(ChatCore.watch_channel(GUILD, 0))
	await settle()
	assert_eq(last_message_request().channel_key, 0, "the Guild channel key is 0")
	add_messages(messages(GUILD, OTHER_GUILD_ID, PackedInt64Array([9]), 9, 9, LONG_MS))
	add_messages(messages(GUILD, OTHER_GUILD_ID, PackedInt64Array([4, 5]), 5, 4, POLL_MS))
	await pass_time(POLL_MS)
	assert_eq(message_requests().size(), 3, "the first request goes right after the reset")
	var request: CoreContract.GetChatMessagesRequest = last_message_request()
	assert_eq(PackedInt64Array([request.after_seq, request.after_delete_seq]), PackedInt64Array([0, 0]))
	assert_eq(changes, PackedStringArray(["0 Reset 2", "0 Reset 0", "0 Reset 2"]))
	assert_eq(cached_seqs(GUILD, 0), PackedInt64Array([4, 5]))
	add_error(GET_MESSAGES, CoreContract.CoreError.CORE_ERROR_GUILD_NOT_MEMBER)
	await pass_time(POLL_MS)
	assert_eq(network_errors(), 1)
	assert_eq(ChatCore.get_message_count(GUILD, 0), 0)
	assert_false(ChatCore.has_older(GUILD, 0))
	assert_eq(changes, PackedStringArray(["0 Reset 2", "0 Reset 0", "0 Reset 2", "0 Reset 0"]))
	add_messages(messages(GUILD, GUILD_ID, PackedInt64Array([2]), 2, 2, LONG_MS))
	await pass_time(FAILURE_RETRY_MS)
	assert_eq(last_message_request().after_seq, 0, "the first request again after the failure retry")


func test_after_unwatch_no_request_goes_and_the_response_on_the_way_makes_no_event() -> void:
	await start_chat([])
	UnitTestCore.add_pending(GET_MESSAGES)
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	await settle()
	ChatCore.unwatch_channel(DIRECT, FRIEND_ID)
	assert_true(release_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([1]), 1, 1, POLL_MS)))
	await settle()
	assert_eq(changes, PackedStringArray(), "no event")
	assert_eq(ChatCore.get_message_count(DIRECT, FRIEND_ID), 0)
	await pass_time(POLL_MS * 3)
	assert_eq(message_requests().size(), 1, "no request after unwatch")


func test_watch_channel_over_the_limit_is_false() -> void:
	await start_chat([])
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array(), 0, 0))
	add_messages(messages(DIRECT, OTHER_FRIEND_ID, PackedInt64Array(), 0, 0))
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	assert_true(ChatCore.watch_channel(DIRECT, OTHER_FRIEND_ID))
	assert_false(ChatCore.watch_channel(WORLD, WORLD_NUMBER), "ChatCore.maxWatchedChannels is %d" % MAX_WATCHED)
	assert_eq(chat_warns(), 1)
	await settle()
	assert_eq(message_requests().size(), 2)
	ChatCore.unwatch_channel(DIRECT, FRIEND_ID)
	add_messages(messages(WORLD, WORLD_NUMBER, PackedInt64Array(), 0, 0))
	assert_true(ChatCore.watch_channel(WORLD, WORLD_NUMBER), "a free place after unwatch")
	await settle()
