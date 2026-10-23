extends "res://core/chat_core/tests/support/chat_test_case.gd"
## The rows of the ChatCore error table that the other test files do not cover.

const UNSPECIFIED: CoreContract.ChatChannelKind = CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_UNSPECIFIED


func test_an_unspecified_kind_or_a_channel_key_that_does_not_fit_the_kind_is_an_error() -> void:
	await start_chat([])
	assert_eq(ChatCore.get_unread_count(UNSPECIFIED, 1), 0)
	ChatCore.mark_read(WORLD, 0)
	assert_false(ChatCore.watch_channel(GUILD, GUILD_ID), "Guild takes 0")
	ChatCore.unwatch_channel(DIRECT, 0)
	assert_eq(ChatCore.get_message_count(DIRECT, -1), 0)
	assert_null(ChatCore.get_message(WORLD, 0, 0))
	assert_false(ChatCore.has_older(99 as CoreContract.ChatChannelKind, 1), "not a ChatChannelKind")
	assert_false(await ChatCore.load_older(GUILD, 1))
	var sent: ChatSendResult = await ChatCore.send_message(UNSPECIFIED, 1, TEXT, "x")
	assert_false(sent.ok)
	assert_eq(sent.error_code, 0)
	var bad_kind: ChatSendResult = await ChatCore.send_message(DIRECT, FRIEND_ID, CoreContract.ChatMessageKind.CHAT_MESSAGE_KIND_UNSPECIFIED, "x")
	assert_false(bad_kind.ok)
	assert_eq(chat_errors(), 10)
	assert_eq(request_count(GET_MESSAGES) + request_count(SEND), 0)


func test_watch_channel_before_start_is_an_error_and_start_twice_is_a_warn() -> void:
	await start_chat([], false)
	assert_false(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	assert_eq(chat_errors(), 1)
	await start_with([])
	ChatCore.start()
	assert_eq(chat_warns(), 1)
	await settle()
	assert_eq(request_count(GET_CHANNELS), 1, "the second start sends nothing")


func test_a_channel_that_is_not_watched_and_an_index_out_of_range_are_warns() -> void:
	await start_chat([entry(DIRECT, FRIEND_ID, 1, 1)])
	assert_false(await ChatCore.load_older(DIRECT, FRIEND_ID))
	assert_null(ChatCore.get_message(DIRECT, FRIEND_ID, 0))
	assert_eq(chat_warns(), 2)
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([1]), 1, 1))
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	await settle()
	assert_null(ChatCore.get_message(DIRECT, FRIEND_ID, 1))
	assert_null(ChatCore.get_message(DIRECT, FRIEND_ID, -1))
	assert_null(ChatCore.get_channel(1))
	assert_eq(ChatCore.get_channel(0).channel_key, FRIEND_ID)
	assert_eq(chat_warns(), 3)
	assert_eq(chat_errors(), 0)
