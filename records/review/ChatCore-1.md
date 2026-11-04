# ChatCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/chat_core/chat_core.gd:669 | Input D2. When `epoch != w.epoch` (a `load_older` of that `Guild` channel ended with `GUILD_NOT_MEMBER` while the poll was on the way, `_check_not_member` at line 773 raised `w.epoch`), lines 669-671 set the next poll to `now + _failure_retry_ms` even when the poll itself succeeded. `open-game-works-core/skills/client-core/modules/chat-core.md:87` waits `poll_after_ms` when the previous request succeeded. Run path: `watch_channel(GUILD, 0)`, poll pending, `load_older` gets `GUILD_NOT_MEMBER`, the poll response arrives with `poll_after_ms` smaller than `ChatCore.failureRetryMs`: the next request waits `failureRetryMs` | On a successful response with a changed epoch, set `due_at` from `response.poll_after_ms`; keep `_failure_retry_ms` for a failed one | no | 85 |
| R1-2 | test evidence | medium | client/godot/core/chat_core/chat_core.gd:854 | Input D3. The `w.busy` branch of `_on_sent` (`w.kick = true`) and lines 682-685 of `_send_poll` have no test. `chat-core.md:106` requires the poll right after a send success. `test_after_a_sent_message_the_watched_channel_polls_now_and_the_message_comes_once` (client/godot/core/chat_core/tests/test_send.gd:5) sends while no poll is on the way, so only the `else` branch at line 856 runs; the only `GET_MESSAGES` held pending together with a send (test_channel_poll.gd:162) belongs to `load_older` and ends with `release` | Add a test that holds the poll pending, sends a message, releases the poll and asserts the next poll goes without waiting `poll_after_ms` | no | 85 |
| R1-3 | test evidence | medium | client/godot/core/chat_core/chat_core.gd:773 | Input D4. `load_older` ending with `GUILD_NOT_MEMBER` has no test, nor the `epoch` branches that drop results after that reset (lines 669 and 768). `chat-core.md:93` applies to any request of a `Guild` channel; the only test with that error is the poll at client/godot/core/chat_core/tests/test_watch.gd:93, and the only failed `load_older` (test_older.gd:61) is a `Direct` channel with `INTERNAL` | Add a test of a `Guild` `load_older` that ends with `GUILD_NOT_MEMBER` (cache empty, `Reset` 0) while a poll is pending, and assert the poll result is dropped | no | 85 |
| R1-4 | test evidence | medium | client/godot/core/chat_core/chat_core.gd:723 | Input D5. `chat-core.md:75` raises the read seq when a watched channel receives messages and `chat-core.md:179` requires its unread to become 0, but no test goes through the poll path. `test_a_watched_channel_that_receives_messages_has_no_unread` (client/godot/core/chat_core/tests/test_watch.gd:67) receives its messages only in the first request (`_apply_first`, line 696). Removing the `_raise_from_cache` call at line 723 fails no assert in client/godot/core/chat_core/tests/ | Extend the test so that a poll appends messages above the read seq and assert unread 0 and no `[chat_badge]` item | no | 85 |
| R1-5 | test evidence | medium | client/godot/core/chat_core/chat_core.gd:607 | Input D6. `chat-core.md:79` and `chat-core.md:173` require a `[chat_badge]` item with the current unread count; no test changes the count of an item that stays at 1 or more. Every badge assert in test_read_seq.gd, test_lifecycle.gd and test_send.gd sees an item appear from 0 or go to 0 (e.g. test_read_seq.gd:131-132 goes 0 to 2). Reducing the condition at line 607 to `not _badge_items.has(item)` keeps the first count and fails no assert | Add a test where unread of one channel goes from 1 or more to another value of 1 or more and assert the item count | no | 85 |
| R1-6 | test evidence | medium | client/godot/core/chat_core/chat_core.gd:707 | Input D7. `chat-core.md:88-92` sets the poll order `Removed` then `Appended`; no test has one poll response with both `deleted_seqs` and new messages. `test_deleted_seqs_leave_the_cache_with_a_removed_event_of_that_count` (client/godot/core/chat_core/tests/test_watch.gd:50) has no new messages in that response, so moving the removal block after the append block fails no assert | Add a poll response with both and assert the event order `Removed`, `Appended` | no | 85 |
| R1-7 | test evidence | medium | client/godot/core/chat_core/chat_core.gd:704 | Input D8. `chat-core.md:65` sends nothing until `release` after `CHILD_RESTRICTED`; no test has a `Guild` poll on the way when the restriction arrives. `test_child_restricted_stops_every_request_until_release_init_and_start` (client/godot/core/chat_core/tests/test_channel_poll.gd:121) holds no poll pending. Run path with no test: a `Guild` poll is pending, `GetChatChannels` ends with `CHILD_RESTRICTED`, the poll response has another `channel_key`; removing `and not _restricted` then sends a first request after the restriction and fails no assert | Add that run path to the test and assert no request follows | no | 85 |
| R1-8 | test evidence | medium | client/godot/core/chat_core/chat_core.gd:736 | Input D9. `chat-core.md:93` resets the cache only on `GUILD_NOT_MEMBER`; no test has a `Guild` request fail with another error (the only `Guild` failure asserted is `GUILD_NOT_MEMBER` at client/godot/core/chat_core/tests/test_watch.gd:93; test_older.gd:61 is `Direct`). Removing the error code condition at lines 737-738 so that any failure empties the cache fails no assert | Add a `Guild` poll that fails with `INTERNAL` and assert the cache and cursors stay | no | 85 |
| R1-9 | test evidence | medium | client/godot/core/chat_core/chat_core.gd:741 | Input D10. `chat-core.md:93` publishes `Reset`(0) only when the cache had messages; no test has `GUILD_NOT_MEMBER` on an empty cache (client/godot/core/chat_core/tests/test_watch.gd:93 has the cache [4, 5]). Publishing regardless of `had` fails no assert | Add `GUILD_NOT_MEMBER` on an empty `Guild` cache and assert no event | no | 85 |
| R1-10 | test evidence | medium | client/godot/core/chat_core/chat_core.gd:435 | Input D11. `chat-core.md:65` publishes `ChatChannelsChangedEvent` on `CHILD_RESTRICTED` only when the list changed; no test has `CHILD_RESTRICTED` with an empty list (client/godot/core/chat_core/tests/test_channel_poll.gd:121 starts with one item). Publishing always at this line fails no assert | Add `CHILD_RESTRICTED` on an empty list and assert no `ChatChannelsChangedEvent` | no | 85 |
| R1-11 | test evidence | medium | client/godot/core/chat_core/chat_core.gd:287 | Input D12. `chat-core.md:94` discards the results of requests in progress on `unwatch_channel`; no test calls `unwatch_channel` while a `load_older` is in progress (client/godot/core/chat_core/tests/test_watch.gd:104 holds only a poll pending). Removing the `wait.fire(false)` loop at lines 287-288 leaves the caller of `load_older` waiting forever (`_send_older` returns at line 761-762 without firing waits) and fails no assert | Add a test that unwatches during a pending `load_older` and asserts it ends `false` with no event | no | 85 |
| R1-12 | correctness | medium | client/godot/core/chat_core/chat_core.gd:785 | Input D13. `_apply_older` puts received messages in the cache but does not call `_raise_from_cache`; only `_apply_first` (line 696) and `_apply_poll` (line 723) do. `chat-core.md:75` raises the read seq when a watched channel receives messages and `chat-core.md:179` requires its unread to become 0. Reproducing input: saved read seq `CHAT_CHANNEL_KIND_DIRECT:501=2`, list item `last_seq` 60, `last_visible_seq` 5; first response with no messages, `last_seq` 60, `first_seq` 11 (the newest rows are all deleted or from blocked senders); `load_older` response with seqs 4 and 5. The cache is [4, 5] while `get_unread_count` stays 3 and the `[chat_badge]` item stays 3 | Call `_raise_from_cache(w)` in `_apply_older` when messages were added, and add a test with that input | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | open | R1-1 | client/godot/core/chat_core/chat_core.gd:669-671 unchanged: a successful poll after an epoch change still waits `_failure_retry_ms` |
| D3 | open | R1-2 | client/godot/core/chat_core/chat_core.gd:854-855 and 682-685 unchanged; client/godot/core/chat_core/tests/test_send.gd has no send while a poll is pending |
| D4 | open | R1-3 | client/godot/core/chat_core/chat_core.gd:773 unchanged; `GUILD_NOT_MEMBER` appears only at client/godot/core/chat_core/tests/test_watch.gd:93, a poll |
| D5 | open | R1-4 | client/godot/core/chat_core/tests/test_watch.gd:67 still receives messages only by the first request |
| D6 | open | R1-5 | No badge assert in client/godot/core/chat_core/tests/ sees an item count change between two values of 1 or more |
| D7 | open | R1-6 | client/godot/core/chat_core/tests/test_watch.gd:55-58 still has no new messages with `deleted_seqs` |
| D8 | open | R1-7 | client/godot/core/chat_core/tests/test_channel_poll.gd:121 still holds no poll pending at `CHILD_RESTRICTED` |
| D9 | open | R1-8 | No `Guild` request failure other than `GUILD_NOT_MEMBER` in client/godot/core/chat_core/tests/ |
| D10 | open | R1-9 | The only `GUILD_NOT_MEMBER` test (test_watch.gd:93) has a non-empty cache |
| D11 | open | R1-10 | The only `CHILD_RESTRICTED` test (test_channel_poll.gd:121) has a list of one item |
| D12 | open | R1-11 | No test calls `unwatch_channel` during `load_older`; test_watch.gd:104 holds only a poll |
| D13 | open | R1-12 | client/godot/core/chat_core/chat_core.gd:778-789 still has no read seq raise |

## must fix

none

## unknown

- The commit range is empty (e02d2bf..e02d2bf) and client/godot/core/chat_core/ has only its initial commit in history, so the code and tests are the ones the debt items were written against. The debt items were decided by reading the code and every file of client/godot/core/chat_core/tests/ except tests/support/ and tests/resources/; the mutation runs named in the debt items were not run again in this round, and `ogw core test godot ChatCore` was not run
- Code outside client/godot/core/chat_core/ (NetworkCore, BadgeCore, EventCore, LocalDataCore, TimeCore internals) was not read
