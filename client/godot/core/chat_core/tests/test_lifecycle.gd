extends "res://core/chat_core/tests/support/chat_test_case.gd"
## Lifecycle of ChatCore.


func _root_has_core_node() -> bool:
	for child: Node in (Engine.get_main_loop() as SceneTree).root.get_children():
		if child.name == "ChatCore":
			return true
	return false


func _assert_initial_state() -> void:
	assert_false(ChatCore._is_initialized)
	assert_eq(ChatCore._node, null)
	assert_true(ChatCore._due_call.is_null())
	assert_true(ChatCore._sync_call.is_null())
	assert_false(ChatCore._due_queued)
	assert_false(ChatCore._sync_queued)
	assert_eq(ChatCore._max_watched, 0)
	assert_eq(ChatCore._failure_retry_ms, 0)
	assert_false(ChatCore._started)
	assert_false(ChatCore._restricted)
	assert_true(ChatCore._channels.is_empty())
	assert_false(ChatCore._channels_busy)
	assert_eq(ChatCore._channels_due_at, -1)
	assert_true(ChatCore._channel_waits.is_empty())
	assert_true(ChatCore._read_seqs.is_empty())
	assert_false(ChatCore._read_initialized)
	assert_false(ChatCore._read_dirty)
	assert_true(ChatCore._badge_items.is_empty())
	assert_false(ChatCore._badge_missing_logged)
	assert_true(ChatCore._watches.is_empty())
	assert_true(ChatCore._watch_list.is_empty())
	assert_true(ChatCore._send_waits.is_empty())
	assert_false(_root_has_core_node())


func test_init_and_release() -> void:
	assert_false(ChatCore.is_initialized())
	await start_chat([entry(DIRECT, FRIEND_ID, 3, 3)], true, true, PackedStringArray(["CHAT_CHANNEL_KIND_DIRECT:501=1"]))
	assert_true(ChatCore.is_initialized())
	assert_true(_root_has_core_node())
	assert_false(ChatCore.init(), "init twice")
	assert_eq(chat_errors(), 1)
	add_messages(messages(WORLD, WORLD_NUMBER, PackedInt64Array([1]), 1, 1))
	assert_true(ChatCore.watch_channel(WORLD, WORLD_NUMBER))
	await settle()
	assert_eq(badge_item(FRIEND_ID), 2)
	ChatCore.release()
	await UnitTestCore.wait_frames(1)
	assert_false(ChatCore.is_initialized())
	_assert_initial_state()
	assert_eq(badge_item(FRIEND_ID), 0, "release takes the items it set off the badge")
	assert_eq(saved_seqs(), PackedStringArray(["CHAT_CHANNEL_KIND_DIRECT:501=1"]), "the saved read seqs stay")
	assert_true(ChatCore.init(), "init after release")
	assert_true(ChatCore.is_initialized())
	assert_eq(ChatCore.get_channel_count(), 0, "the channel list is gone")
	assert_eq(ChatCore.get_message_count(WORLD, WORLD_NUMBER), 0, "the watch list is gone")
	ChatCore.release()


func test_calls_before_init_and_after_release_fail_with_an_error_log() -> void:
	await start_chat([], false)
	ChatCore.release()
	ChatCore.start()
	assert_false(await ChatCore.refresh_channels())
	assert_eq(ChatCore.get_channel_count(), 0)
	assert_null(ChatCore.get_channel(0))
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 0)
	ChatCore.mark_read(DIRECT, FRIEND_ID)
	assert_false(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	ChatCore.unwatch_channel(DIRECT, FRIEND_ID)
	assert_eq(ChatCore.get_message_count(DIRECT, FRIEND_ID), 0)
	assert_null(ChatCore.get_message(DIRECT, FRIEND_ID, 0))
	assert_false(ChatCore.has_older(DIRECT, FRIEND_ID))
	assert_false(await ChatCore.load_older(DIRECT, FRIEND_ID))
	assert_false((await ChatCore.send_message(DIRECT, FRIEND_ID, TEXT, "x")).ok)
	assert_eq(chat_errors(), 13)
	assert_eq(request_count(), 0)


func test_core_node_leaving_the_tree_cleans_up() -> void:
	await start_chat([])
	UnitTestCore.add_pending(GET_CHANNELS)
	var refreshed: Run = refresh_in_background()
	await settle()
	var node: Node = ChatCore._node
	node.get_parent().remove_child(node)
	node.free()
	assert_false(ChatCore.is_initialized())
	assert_false(await wait_run(refreshed))
	_assert_initial_state()
