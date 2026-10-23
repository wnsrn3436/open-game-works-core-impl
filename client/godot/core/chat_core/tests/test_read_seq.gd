extends "res://core/chat_core/tests/support/chat_test_case.gd"
## Read seqs: the first channel list, new channels, unread counts, the `[chat_badge]` items, `mark_read`, saving and
## the saved value after `release`, `init` and `start`, and a channel that leaves the list and comes back.

const GUILD_READ: String = "CHAT_CHANNEL_KIND_GUILD:77"
const FRIEND_READ: String = "CHAT_CHANNEL_KIND_DIRECT:501"
const OTHER_FRIEND_READ: String = "CHAT_CHANNEL_KIND_DIRECT:502"


func refresh_with(entries: Array[CoreContract.ChatChannelEntry]) -> void:
	add_channels(entries)
	assert_true(await ChatCore.refresh_channels())
	await settle()


func sorted_saved() -> PackedStringArray:
	var out: PackedStringArray = saved_seqs()
	out.sort()
	return out


func test_the_first_list_of_a_new_user_has_no_unread_and_sets_read_initialized() -> void:
	await start_chat([entry(DIRECT, FRIEND_ID, 4, 4), entry(WORLD, WORLD_NUMBER, 50, 50)])
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 0)
	assert_eq(ChatCore.get_unread_count(WORLD, WORLD_NUMBER), 0)
	assert_true(LocalDataCore.get_value_bool(LocalDataCore.FileKind.USER, READ_INITIALIZED_KEY, false))
	assert_eq(badge_item(FRIEND_ID), 0)
	assert_eq(saved_seqs(), PackedStringArray(["%s=4" % FRIEND_READ]), "World keeps no read seq")
	await refresh_with([entry(DIRECT, FRIEND_ID, 4, 4), entry(DIRECT, OTHER_FRIEND_ID, 3, 3), entry(GUILD, GUILD_ID, 10, 10)])
	assert_eq(ChatCore.get_unread_count(DIRECT, OTHER_FRIEND_ID), 3, "a new Direct channel: last_visible_seq")
	assert_eq(ChatCore.get_unread_count(GUILD, 0), 0, "a new Guild channel: 0")
	await refresh_with([entry(DIRECT, FRIEND_ID, 4, 4), entry(DIRECT, OTHER_FRIEND_ID, 3, 3), entry(GUILD, GUILD_ID, 12, 12)])
	assert_eq(ChatCore.get_unread_count(GUILD, 0), 2, "last_visible_seq went up by 2")
	assert_eq(badge_item(-1), 2)
	await refresh_with([entry(DIRECT, FRIEND_ID, 9, 4), entry(DIRECT, OTHER_FRIEND_ID, 3, 3), entry(GUILD, GUILD_ID, 12, 12)])
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 0, "last_seq went up, last_visible_seq is at the read seq")
	assert_eq(badge_item(FRIEND_ID), 0, "no item for the channel")


func test_each_unread_channel_has_a_badge_item_until_mark_read() -> void:
	var saved: PackedStringArray = PackedStringArray(["%s=4" % GUILD_READ, "%s=1" % FRIEND_READ])
	await start_chat([entry(GUILD, GUILD_ID, 6, 6), entry(DIRECT, FRIEND_ID, 3, 3), entry(DIRECT, OTHER_FRIEND_ID, 2, 2)], true, true, saved)
	assert_eq(badge_item(-1), 2, "the Guild item key is -1")
	assert_eq(badge_item(FRIEND_ID), 2)
	assert_eq(badge_item(OTHER_FRIEND_ID), 2, "a new Direct channel")
	ChatCore.mark_read(GUILD, 0)
	await settle()
	assert_eq(ChatCore.get_unread_count(GUILD, 0), 0)
	assert_eq(badge_item(-1), 0)
	assert_eq(badge_item(FRIEND_ID), 2)
	ChatCore.mark_read(DIRECT, FRIEND_ID)
	await settle()
	assert_eq(badge_item(FRIEND_ID), 0)
	assert_eq(badge_item(OTHER_FRIEND_ID), 2)


func test_read_seqs_stay_after_release_init_and_start_and_a_channel_out_of_the_list_stays_in_the_saved_value() -> void:
	await start_chat([entry(GUILD, GUILD_ID, 6, 6), entry(DIRECT, FRIEND_ID, 3, 3)])
	assert_eq(sorted_saved(), PackedStringArray(["%s=3" % FRIEND_READ, "%s=6" % GUILD_READ]))
	await restart_chat([entry(GUILD, GUILD_ID, 8, 8), entry(DIRECT, FRIEND_ID, 3, 3)])
	assert_eq(ChatCore.get_unread_count(GUILD, 0), 2, "the read seq 6 stayed")
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 0)
	await refresh_with([entry(GUILD, GUILD_ID, 8, 8)])
	assert_eq(sorted_saved(), PackedStringArray(["%s=3" % FRIEND_READ, "%s=6" % GUILD_READ]), "the Direct channel out of the list stays")
	ChatCore.mark_read(GUILD, 0)
	ChatCore.release()
	assert_eq(sorted_saved(), PackedStringArray(["%s=3" % FRIEND_READ, "%s=8" % GUILD_READ]), "release saves the read seq it did not save yet")


func test_a_channel_that_comes_back_to_the_list_counts_unread_from_the_read_seq_it_kept() -> void:
	var saved: PackedStringArray = PackedStringArray(["%s=100" % FRIEND_READ])
	await start_chat([entry(DIRECT, FRIEND_ID, 100, 100), entry(GUILD, GUILD_ID, 5, 5)], true, true, saved)
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 0)
	await refresh_with([entry(GUILD, GUILD_ID, 5, 5)])
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 0, "out of the list")
	assert_eq(sorted_saved(), PackedStringArray(["%s=100" % FRIEND_READ, "%s=5" % GUILD_READ]))
	await restart_chat([entry(GUILD, GUILD_ID, 5, 5)])
	await refresh_with([entry(DIRECT, FRIEND_ID, 101, 101), entry(GUILD, GUILD_ID, 5, 5)])
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 1, "the read seq 100 stayed, not 0 of a new Direct channel")
	assert_eq(badge_item(FRIEND_ID), 1)
	assert_eq(sorted_saved(), PackedStringArray(["%s=100" % FRIEND_READ, "%s=5" % GUILD_READ]))


func test_malformed_saved_elements_are_dropped_with_a_warn_log() -> void:
	var saved: PackedStringArray = PackedStringArray([
		"%s=2" % FRIEND_READ, "broken", "CHAT_CHANNEL_KIND_WORLD:3=1", "CHAT_CHANNEL_KIND_DIRECT:x=1",
		"CHAT_CHANNEL_KIND_DIRECT:0=1", "CHAT_CHANNEL_KIND_DIRECT:502=-1",
	])
	await start_chat([entry(DIRECT, FRIEND_ID, 5, 5)], true, true, saved)
	assert_eq(chat_warns(), 5)
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 3, "the well-formed element is read")
	assert_eq(saved_seqs(), PackedStringArray(["%s=2" % FRIEND_READ]))


func test_a_read_seq_does_not_go_down() -> void:
	await start_chat([entry(DIRECT, FRIEND_ID, 5, 5)])
	await refresh_with([entry(DIRECT, FRIEND_ID, 3, 3)])
	ChatCore.mark_read(DIRECT, FRIEND_ID)
	await settle()
	await refresh_with([entry(DIRECT, FRIEND_ID, 7, 7)])
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 2, "the read seq stayed 5")


func test_mark_read_keeps_the_largest_cached_seq_when_it_is_above_the_list_last_seq() -> void:
	await start_chat([entry(DIRECT, FRIEND_ID, 5, 5)])
	add_messages(messages(DIRECT, FRIEND_ID, PackedInt64Array([4, 5]), 5, 4))
	assert_true(ChatCore.watch_channel(DIRECT, FRIEND_ID))
	await settle()
	await refresh_with([])
	assert_eq(saved_seqs(), PackedStringArray(["%s=5" % FRIEND_READ]), "the channel left the list and kept its read seq")
	await refresh_with([entry(DIRECT, FRIEND_ID, 3, 3)])
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 0, "the list is behind the cache")
	ChatCore.mark_read(DIRECT, FRIEND_ID)
	await settle()
	assert_eq(saved_seqs(), PackedStringArray(["%s=5" % FRIEND_READ]), "the largest cached seq, not last_seq 3")
	await refresh_with([entry(DIRECT, FRIEND_ID, 6, 6)])
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 1)


func test_mark_read_of_a_guild_takes_the_cache_only_while_it_is_of_the_listed_guild() -> void:
	var other_guild_read: String = "CHAT_CHANNEL_KIND_GUILD:%d" % OTHER_GUILD_ID
	await start_chat([entry(GUILD, GUILD_ID, 900, 900)])
	add_messages(messages(GUILD, GUILD_ID, PackedInt64Array([899, 900]), 900, 899))
	assert_true(ChatCore.watch_channel(GUILD, 0))
	await settle()
	await refresh_with([entry(GUILD, OTHER_GUILD_ID, 10, 10)])
	ChatCore.mark_read(GUILD, 0)
	await settle()
	assert_eq(sorted_saved(), PackedStringArray(["%s=900" % GUILD_READ, "%s=10" % other_guild_read]), "the cache is still of guild 77")
	await refresh_with([entry(GUILD, OTHER_GUILD_ID, 12, 12)])
	assert_eq(ChatCore.get_unread_count(GUILD, 0), 2)
	assert_eq(badge_item(-1), 2)
	await refresh_with([])
	await refresh_with([entry(GUILD, GUILD_ID, 897, 897)])
	assert_eq(ChatCore.get_unread_count(GUILD, 0), 0, "guild 77 kept the read seq 900 out of the list")
	ChatCore.mark_read(GUILD, 0)
	await settle()
	assert_eq(sorted_saved(), PackedStringArray(["%s=900" % GUILD_READ, "%s=10" % other_guild_read]), "the cache is of the listed guild 77")
	await refresh_with([entry(GUILD, GUILD_ID, 901, 901)])
	assert_eq(ChatCore.get_unread_count(GUILD, 0), 1)


func test_a_chat_badge_that_is_not_a_badge_row_sets_no_item_and_logs_one_error_until_release() -> void:
	var saved: PackedStringArray = PackedStringArray(["%s=1" % FRIEND_READ])
	await start_chat([entry(DIRECT, FRIEND_ID, 3, 3), entry(GUILD, GUILD_ID, 4, 4)], true, true, saved, CHAT_BADGE_ROW)
	assert_false(GameData.BadgeTable.has_row(ReservedId.chat_badge()), "the data has no [chat_badge] row")
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 2)
	assert_true(ChatCore._badge_items.is_empty(), "no item")
	await refresh_with([entry(DIRECT, FRIEND_ID, 5, 5), entry(GUILD, GUILD_ID, 4, 4)])
	ChatCore.mark_read(DIRECT, FRIEND_ID)
	await settle()
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 0)
	assert_eq(chat_errors(), 1, "one error for three badge syncs")
	assert_eq(UnitTestCore.check_logs("error", "BadgeCore"), 0, "no BadgeCore call with the missing badge")
	await restart_chat([entry(DIRECT, FRIEND_ID, 7, 7)])
	assert_eq(ChatCore.get_unread_count(DIRECT, FRIEND_ID), 2)
	await refresh_with([entry(DIRECT, FRIEND_ID, 8, 8)])
	assert_true(ChatCore._badge_items.is_empty())
	assert_eq(chat_errors(), 1, "one error again after release, init and start")
