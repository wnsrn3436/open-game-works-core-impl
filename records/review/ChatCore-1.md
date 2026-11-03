# review ChatCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/chat_core/chat_core.gd:723: medium `open-game-works-core/skills/client-core/modules/chat-core.md:75` raises the read seq when a watched channel receives messages, and `chat-core.md:179` requires a test that its unread becomes 0, but no test goes through the poll path. `test_a_watched_channel_that_receives_messages_has_no_unread` (client/godot/core/chat_core/tests/test_watch.gd:67) receives its messages only in the first request (chat_core.gd:696). Run: removing the `_raise_from_cache` call at line 723 in a temporary copy and running `ogw core test godot ChatCore` gives `ChatCore pass`. With that defect, a channel open on screen shows a growing unread count for each message that arrives by poll
- client/godot/core/chat_core/chat_core.gd:607: medium `chat-core.md:79` and `chat-core.md:173` require a `[chat_badge]` item with the current unread count, and no test changes the count of an item that stays at 1 or more. Run: reducing the condition at line 607 to `not _badge_items.has(item)`, so that an existing item is not updated, gives `ChatCore pass` (combined run, see `## unknown`). With that defect, the badge keeps the first count while unread rises
- client/godot/core/chat_core/chat_core.gd:707: medium `chat-core.md:88-92` sets the poll order `Removed` then `Appended`, and no test has one poll response with both `deleted_seqs` and new messages. `test_deleted_seqs_leave_the_cache_with_a_removed_event_of_that_count` (test_watch.gd) has no new messages in that response. Run: moving the removal block after the append block gives `ChatCore pass` (combined run)
- client/godot/core/chat_core/chat_core.gd:704: medium `chat-core.md:65` sends nothing until `release` after `CHILD_RESTRICTED`, and no test has a poll on the way when the restriction arrives. `test_child_restricted_stops_every_request_until_release_init_and_start` (test_channel_poll.gd) holds no poll pending. Run path with no test: a `Guild` poll is pending, `GetChatChannels` ends with `CHILD_RESTRICTED`, the poll response has another `channel_key`. Run: removing `and not _restricted` at this line, which then sends a first request after the restriction, gives `ChatCore pass` (combined run)
- client/godot/core/chat_core/chat_core.gd:736: medium `chat-core.md:93` resets the cache only on `GUILD_NOT_MEMBER`, and no test has a `Guild` request fail with another error. The only `Guild` request failure asserted is `GUILD_NOT_MEMBER` in test_watch.gd. Run: removing the error code condition at lines 736-737, so that any failure empties the cache, gives `ChatCore pass` (combined run). With that defect, one `INTERNAL` or timeout on a guild poll empties the chat on screen
- client/godot/core/chat_core/chat_core.gd:741: medium `chat-core.md:93` publishes `Reset`(0) only when the cache had messages, and no test has `GUILD_NOT_MEMBER` on an empty cache. Run: publishing whatever the cache held gives `ChatCore pass` (combined run). With that defect, a watched `Guild` channel of a user without a guild publishes `Reset` every `ChatCore.failureRetryMs`
- client/godot/core/chat_core/chat_core.gd:435: medium `chat-core.md:65` publishes `ChatChannelsChangedEvent` on `CHILD_RESTRICTED` only when the list changed, and no test has `CHILD_RESTRICTED` with an empty list. test_channel_poll.gd reaches it only with a list of one item. Run: publishing always at this line gives `ChatCore pass` (combined run)
- client/godot/core/chat_core/chat_core.gd:287: medium `chat-core.md:94` discards the results of requests in progress on `unwatch_channel`, and no test calls `unwatch_channel` while a `load_older` is in progress; test_watch.gd holds only a poll pending. Run: removing the `wait.fire(false)` loop at lines 287-288 gives `ChatCore pass` (combined run). With that defect, the `load_older` of the caller never returns

## debt

none

## must fix

none

## unknown

- Why there are no findings: the commit range changes no file of client/godot/core/chat_core, of the code folders of `LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `NetworkCore`, `BadgeCore`, of server/core/chat, core-spec/ChatCore.json or proto/. The range edits to settings/core-settings.json, client/godot/generated/core_settings*.json and core-spec files of other modules add, remove or move keys of other modules only. The `ChatCore.*` settings are unchanged. The range edits to tools/data-tool/src/corespec.ts and godotgen.ts were read, and reach ChatCore only through the table closure of its reserved ID row `badge`. Their effect on ChatCore was not run: the data tool tests were not run
- The whole of client/godot/core/chat_core/chat_core.gd and its helper and event files, and tests/test_*.gd, were read against chat-core.md for `## out of scope`. No correctness defect with a reproducing run was found in them. Lines 240 onward of tests/support/chat_test_case.gd were not read
- How the runs were made: a temporary clone of the range end commit, deleted after the runs, with `ogw core test godot ChatCore`. "Combined run" is one run with the defects at lines 287, 435, 607, 704, 707, 736 and 741 restored together, which printed `ChatCore pass`; they were not each run alone, so a defect masking another in that run is not excluded. Line 723 was run alone. As a control, adding that defect and a wrong `Appended` count to the combined run printed `ChatCore fail` with the count asserts, so the runs used the changed copy. Only the native headless run was made, not `--web`
- The debt list records/review-debt/ChatCore.json has D2 (chat_core.gd:669), D3 (chat_core.gd:854) and D4 (chat_core.gd:773). Input `## debt` is `none` because a review with a commit range does not put the debt list in its scope, so those items were not judged and are not written again
- Not written, confidence below 80: chat_core.gd uses the generated `GameData.BadgeTable` and `ReservedId` while `DataCore` is not in the `## dependency` of chat-core.md. It is reached through `BadgeCore`, `NoticeCore` does the same, and the documents read do not say whether generated accessors count as a reference to that module. Also not written: `_MAX_DECIMAL_CHARS` (chat_core.gd:29) discards a saved element whose channel ID has 19 digits, which is a valid `int64`, but user IDs come from a sequential identity column (server/core/storage/schema.ts:207), so no run reaches it in normal use
- `chat-core.md:94` does not set the return value of a `load_older` that `unwatch_channel` interrupts. The code returns `false`; the expected value in the line 287 item comes from the error table row for a channel that is not watched
- Defining documents read in part: log-core.md, event-core.md, time-core.md, local-data-core.md and network-core.md were searched for the operations and rules ChatCore uses, not read whole. Of badge-core.md the sections up to `## settings`, of server-core/modules/chat.md the first 200 lines, of engines/godot.md the `engine version`, `folder`, `module`, `GDScript`, `lifecycle` and `frame code` sections, and of core/SKILL.md the dependency lines were read. Whether ChatCore follows the unread parts was not checked
- server/core/chat code was not read; the server behavior was taken from its spec. It is a separate review target
