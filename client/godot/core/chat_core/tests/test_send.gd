extends "res://core/chat_core/tests/support/chat_test_case.gd"
## `send_message`.


func test_after_a_sent_message_the_watched_channel_polls_now_and_the_message_comes_once() -> void:
	await start_chat([entry(DIRECT, FRIEND_ID, 1, 1)])
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([1]), 1, 1))
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	await settle()
	add_sent(DIRECT, FRIEND_ID, 2)
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([2]), 2, 1))
	var sent: ChatSendResult = await ChatCore.send_message(DIRECT, FRIEND_ID, TEXT, "hello")
	assert_true(sent.ok)
	assert_eq(sent.message.seq, 2)
	assert_eq(sent.error_code, 0)
	var body: CoreContract.SendChatMessageRequest = CoreContract.SendChatMessageRequest.new()
	for received: UnitTestRequest in UnitTestCore.received_requests():
		if received.name == SEND:
			assert_true(body.decode(received.body))
	assert_eq(body.channel_kind, DIRECT)
	assert_eq(body.channel_key, FRIEND_ID)
	assert_eq(body.message_kind, TEXT)
	assert_eq(body.text, "hello")
	assert_eq(ChatCore.get_message_count(DIRECT, FRIEND_ID), 1, "the sent message waits for the poll")
	await settle()
	assert_eq(message_requests().size(), 2, "the poll goes without waiting poll_after_ms")
	assert_eq(last_message_request().after_seq, 1)
	assert_eq(cached_seqs(DIRECT, FRIEND_ID), PackedInt64Array([1, 2]))
	assert_eq(changes, PackedStringArray(["501 Reset 1", "501 Appended 1"]))


func test_a_sent_message_raises_the_read_seq_of_a_channel_that_is_not_watched() -> void:
	var saved: PackedStringArray = PackedStringArray(["CHAT_CHANNEL_KIND_DIRECT:501=1"])
	await start_chat([entry(DIRECT, FRIEND_ID, 3, 3)], true, true, saved)
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 2)
	add_sent(DIRECT, FRIEND_ID, 4)
	assert_true((await ChatCore.send_message(DIRECT, FRIEND_ID, TEXT, "hi")).ok)
	add_channels([entry(DIRECT, FRIEND_ID, 4, 4)])
	assert_true(await ChatCore.refresh_channels())
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 0)
	assert_eq(message_requests().size(), 0)


func test_a_sent_guild_message_raises_the_read_seq_of_the_guild_of_the_message() -> void:
	var saved: PackedStringArray = PackedStringArray(["CHAT_CHANNEL_KIND_GUILD:77=4"])
	await start_chat([entry(GUILD, GUILD_ID, 6, 6)], true, true, saved)
	assert_eq(ChatCore.get_unread_count(GUILD, 0), 2)
	add_sent(GUILD, GUILD_ID, 7)
	assert_true((await ChatCore.send_message(GUILD, 0, TEXT, "hi")).ok)
	add_channels([entry(GUILD, GUILD_ID, 7, 7)])
	assert_true(await ChatCore.refresh_channels())
	await settle()
	assert_eq(ChatCore.get_unread_count(GUILD, 0), 0)
	assert_eq(badge_item(-1), 0)
	assert_eq(saved_seqs(), PackedStringArray(["CHAT_CHANNEL_KIND_GUILD:77=7"]))


func test_chat_too_fast_is_the_error_code_of_the_result() -> void:
	await start_chat([])
	add_error(SEND, CoreContract.CoreError.CORE_ERROR_CHAT_TOO_FAST)
	var sent: ChatSendResult = await ChatCore.send_message(GUILD, 0, TEXT, "fast")
	assert_false(sent.ok)
	assert_null(sent.message)
	assert_eq(sent.error_code, CoreContract.CoreError.CORE_ERROR_CHAT_TOO_FAST)
	assert_eq(network_errors(), 1)


func test_send_message_before_start_is_a_failed_result_with_an_error_log() -> void:
	await start_chat([], false)
	var sent: ChatSendResult = await ChatCore.send_message(DIRECT, FRIEND_ID, TEXT, "early")
	assert_false(sent.ok)
	assert_eq(sent.error_code, 0)
	assert_eq(chat_errors(), 1)
	assert_eq(request_count(SEND), 0)
