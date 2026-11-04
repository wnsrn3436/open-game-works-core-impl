# review ChatCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/chat_core/chat_core.gd:785: medium `_apply_older` puts received messages in the cache but does not raise the read seq, so a watched channel whose cache was empty keeps its unread count and its `[chat_badge]` item after it receives messages. `open-game-works-core/skills/client-core/modules/chat-core.md:75` raises the read seq to the largest seq of the cache when a watched channel receives messages, and `chat-core.md:179` requires its unread to become 0. Only `_apply_first` (line 696) and `_apply_poll` (line 723) call `_raise_from_cache`. With a non-empty cache this has no effect, because `load_older` adds only smaller seqs. It needs a first response with no messages and `first_seq` above 1: the server selects the newest `chat.maxFetchCount` rows and leaves out deleted messages and those of blocked senders, so all of those rows can be hidden while older visible messages are unread. Reproduced with a probe test in a temporary copy, run with `ogw core test godot ChatCore`: saved read seq `CHAT_CHANNEL_KIND_DIRECT:501=2`, list item `last_seq` 60 and `last_visible_seq` 5, first response with no messages, `last_seq` 60 and `first_seq` 11, `load_older` response with seqs 4 and 5. The cache is then [4, 5], `get_unread_count` is 3 where 0 is expected, and the `[chat_badge]` item count is 3 where 0 is expected. The code is unchanged in the range

## debt

none

## must fix

none

## unknown

- `client/godot/core/chat_core/`, `core-spec/ChatCore.json` and `tools/data-tool/src/checks/ChatCore.ts` have no change in the commit range. No module in the `## dependency` of ChatCore (`LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `NetworkCore`, `BadgeCore`, server `chat`) has a code change in the range either. The client code changes in the range are only in `client/godot/core/realtime_core/`, and ChatCore does not call it
- The changes in the range nearest to ChatCore are `add_report` and `remove_user` of `block-report`, which server `chat` calls, and the `FallibleRemoveUser` type in `server/core/auth/deps.ts`. They do not change the `GetChatChannels`, `GetChatMessages` or `SendChatMessage` responses that ChatCore reads. This was checked by reading; those server paths were not run for this review
- `settings/core-settings.schema.json` changes in the range do not include `ChatCore.*` keys. `ChatCore.failureRetryMs` and `ChatCore.maxWatchedChannels` stay at minimum 0, as the `core` SKILL.md range rule allows. `ChatCore.failureRetryMs` 0 was not run
- The items of `records/review-debt/ChatCore.json` (D2 to D12) were not checked, because input `## debt` is `none`. They are not written again in `## out of scope`, so this review does not say whether they are still open
- The whole ChatCore code and tests were read against the definitions although the code is out of the range, in order to look for `## out of scope` problems. Other than the line above, only the ChatCore tests were run, in the temporary copy; the only failure was the added probe test. Other modules' tests were not run
- A poll that is already in the `NetworkCore` queue when `unwatch_channel` or `release` is called was not run. `NetworkCore` has no operation that cancels a queued request, so such a request may still go out, while `chat-core.md` says no request of that channel follows. The tests hold the request in the fake network after it was received, not behind another request
- Only the Godot client core exists for this module, so no other engine was checked
