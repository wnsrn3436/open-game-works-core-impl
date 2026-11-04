# review chat round 1

## findings

none

## previous

none

## out of scope

- server/core/chat/tables.ts:294: medium `select_deletions` has no `expires_at` condition, and `GetChatMessages` (server/core/chat/index.ts:354) returns its rows, so a `chat_deletion` row with `expires_at` ≤ `clock_now` that `sweep_expired` has not deleted is delivered in `deleted_seqs` and raises `last_delete_seq`. The storage `### expiry` rule (open-game-works-core/skills/server-core/modules/storage.md:269) says such a row counts as a row that does not exist, also before it is deleted, so the response differs by sweep timing. Reproduced on SQLite and PostgreSQL in a temporary copy: `chat.retentionMs` 10000, `routing.storageSweepIntervalMs` 3600000, two guild messages with seq 1 deleted by `DeleteGuildChatMessage`, clock advanced 10000 ms, `GetChatMessages` with `after_seq` 1 and `after_delete_seq` 0 returns `deleted_seqs` [1]. The code is unchanged in the range
- server/core/chat/tables.ts:289: medium `list_messages` has no `expires_at` condition, and admin `list_chat_messages` (server/core/chat/admin.ts:77) returns its rows, so an operator reads the text of a message whose `chat.retentionMs` has passed until `sweep_expired` deletes the row. The storage `### expiry` rule (open-game-works-core/skills/server-core/modules/storage.md:269) says such a row counts as a row that does not exist, and chat `### admin` only adds deleted messages to the list. Reproduced on SQLite and PostgreSQL in a temporary copy: `chat.retentionMs` 10000, `routing.storageSweepIntervalMs` 3600000, one `World` message, clock advanced 10000 ms, `list_chat_messages` returns that row. The code is unchanged in the range

## debt

none

## must fix

none

## unknown

- `server/core/chat/` has no change in the commit range. The changes in the range that reach chat are `add_report` and `remove_user` of `block-report`, the `FallibleRemoveUser` type of `block-report` in `server/core/auth/deps.ts`, and the minimums of `settings/core-settings.schema.json`, whose `chat.*` keys did not change. I read these with the chat code that calls them and found no finding
- Lock order was checked by reading only: `Withdraw` takes `Direct` channel rows, then guild rows, then the `block_report_sequence` row, and no core path in chat takes them in another order. An `add_report` or a `lock_guild` that content calls from `on_chat_message_sent` or `validate_chat_send` was not run against a concurrent `Withdraw`
- `ReportChatMessage` during a concurrent `Withdraw` of the sender was not run through chat. The tests in `server/core/block-report/tests/withdraw.test.ts` run that order at `add_report`, and they passed
- Tests run in a temporary copy of the checkout at the end of the range, with one added probe test: `ogw core test server chat block-report`. `block-report` passed, and the only `chat` failure was the probe test, whose assert states the behavior the `## out of scope` lines say is missing. The final probe asserts were not rerun with the other chat tests. `server/core/routing/tests/settings-minimum.test.ts` was not run
- The six items of `records/review-debt/chat.json` were not checked, because input `## debt` is `none`. They are not written again in `## out of scope`, so this review does not say whether they are still open
- Client `ChatCore` is not in this target and was not read
