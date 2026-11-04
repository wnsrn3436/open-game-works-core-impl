# ChatCore review round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | client/godot/core/chat_core/chat_core.gd:671-682: a successful response sets `due_at` from `poll_after_ms` whether or not the epoch changed; only a failed one waits `_failure_retry_ms`. Restoring the pre-fix branch (`if not current: w.due_at = now + _failure_retry_ms` before the success branch) in a temporary copy (a detached worktree `worktrees/_core/rv-chat-m0` of HEAD 32e2e8f) and running `ogw core test godot ChatCore --file client/godot/core/chat_core/tests/test_older.gd` fails `test_guild_not_member_of_load_older_empties_the_cache_and_drops_the_poll_on_the_way` ("[3] expected to equal [4]: the successful poll waits its poll_after_ms, not ChatCore.failureRetryMs") |
| R1-2 | fixed | Temporary copy with the `w.busy` branch of `_on_sent` (chat_core.gd:856-857) made `pass`: `test_send.gd::test_a_message_sent_while_a_poll_is_on_the_way_polls_again_right_after_that_poll` fails ("[2] expected to equal [3]: the next poll goes without waiting poll_after_ms") |
| R1-3 | fixed | Temporary copy with the `_check_not_member` call of `_send_older` (chat_core.gd:774) replaced by `pass`: `test_older.gd::test_guild_not_member_of_load_older_empties_the_cache_and_drops_the_poll_on_the_way` fails (cache 3 messages, "0 Appended 1" in place of "0 Reset 0"). Temporary copy with the poll epoch check forced (`var current: bool = true`, chat_core.gd:671): the same test fails (an extra "0 Reset 0" and 5 requests where 3 are expected). The epoch branch of `_send_older` (chat_core.gd:769) made `if false:` still passes, see `## unknown`: no reachable run path tells it apart from the guild check of `_apply_older` |
| R1-4 | fixed | Temporary copy without `_raise_from_cache` in `_apply_poll` (chat_core.gd:724): `test_watch.gd::test_a_watched_channel_that_receives_messages_has_no_unread` fails ("[2] expected to equal [0]: the poll raised the read seq", and the badge item 2) |
| R1-5 | fixed | Temporary copy with the condition of chat_core.gd:607 reduced to `not _badge_items.has(item)`: `test_read_seq.gd::test_each_unread_channel_has_a_badge_item_until_mark_read` fails ("[2] expected to equal [4]: the item follows the unread count") |
| R1-6 | fixed | Temporary copy with the append block of `_apply_poll` moved before the removal block: `test_watch.gd::test_deleted_seqs_leave_the_cache_with_a_removed_event_of_that_count` fails (events "Appended 1", "Removed 1" where "Removed before Appended" is asserted) |
| R1-7 | fixed | Temporary copy without `and not _restricted` at chat_core.gd:705: `test_channel_poll.gd::test_a_guild_poll_on_the_way_at_child_restricted_sends_no_first_request_on_a_guild_change` fails (4 `GetChatMessages` requests where 2 are expected) |
| R1-8 | fixed | Temporary copy without the `GUILD_NOT_MEMBER` condition of `_check_not_member` (chat_core.gd:738-739): `test_watch.gd::test_a_guild_failure_other_than_guild_not_member_keeps_the_cache_and_cursors` fails (empty cache, extra "0 Reset 0", cursors [0, 0] where [5, 3] are expected) |
| R1-9 | fixed | Temporary copy with `if had:` of chat_core.gd:742 made `if true:`: `test_watch.gd::test_guild_not_member_on_an_empty_cache_resets_the_cursors_without_an_event` fails ("no event for an empty cache") |
| R1-10 | fixed | Temporary copy with `if had:` of chat_core.gd:435 made `if true:`: `test_channel_poll.gd::test_child_restricted_on_an_empty_list_publishes_no_channel_event` fails ("[1] expected to equal [0]: the list did not change") |
| R1-11 | fixed | Temporary copy without the `wait.fire(false)` loop of `unwatch_channel` (chat_core.gd:287-288): `test_watch.gd::test_unwatch_during_load_older_ends_it_false_without_an_event` fails ("unwatch_channel ends the load_older on the way") |
| R1-12 | fixed | chat_core.gd:789 `_apply_older` calls `_raise_from_cache(w)` when it added messages. Temporary copy without that call: `test_older.gd::test_messages_of_load_older_raise_the_read_seq` fails (unread 3 and badge item 3 where 0 is expected), with the reproducing input of the finding |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | fixed | none | Same as R1-1 in `## previous` |
| D3 | fixed | none | Same as R1-2 in `## previous` |
| D4 | fixed | none | Same as R1-3 in `## previous` |
| D5 | fixed | none | Same as R1-4 in `## previous` |
| D6 | fixed | none | Same as R1-5 in `## previous` |
| D7 | fixed | none | Same as R1-6 in `## previous` |
| D8 | fixed | none | Same as R1-7 in `## previous` |
| D9 | fixed | none | Same as R1-8 in `## previous` |
| D10 | fixed | none | Same as R1-9 in `## previous` |
| D11 | fixed | none | Same as R1-10 in `## previous` |
| D12 | fixed | none | Same as R1-11 in `## previous` |
| D13 | fixed | none | Same as R1-12 in `## previous` |

## must fix

none

## unknown

- Each defect was restored alone in a temporary copy (detached worktree `worktrees/_core/rv-chat-m0` of HEAD 32e2e8f, removed after the runs) and run with `ogw core test godot ChatCore --file <test file>` for the test file of that finding. The unchanged HEAD passes the whole `ogw core test godot ChatCore`. The `--web` run and the dependents (`BootstrapCore`, `QACore`, `UnitTestCore`) were not run in this review
- The epoch branch of `_send_older` (client/godot/core/chat_core/chat_core.gd:769) has no test that fails when it is removed. `reset()` is called only by `unwatch_channel` (then line 762 returns), `_apply_poll` on a guild change and `_check_not_member`, and both of the last two are `Guild` and set `guild_id` to 0, so a stale `load_older` response is also rejected by the guild check of `_apply_older` (line 780). It would differ only when a first request sent after the reset completes before the stale `load_older` response. That needs NetworkCore to deliver a later request before an earlier one; the internals of NetworkCore (queue order, retries) were not read, so this is not written as a finding
- Code outside client/godot/core/chat_core/ (NetworkCore, BadgeCore, EventCore, LocalDataCore, TimeCore internals) was not read
