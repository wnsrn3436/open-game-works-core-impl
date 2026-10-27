# review chat round 1

## findings

none

## previous

none

## out of scope

- server/core/chat/admin.ts:93: medium admin `delete_chat_message` reads the message row with `T.read_message` (server/core/chat/tables.ts, no `expires_at` condition) and treats any row as existing, so a message row whose `expires_at` ≤ request time that `sweep_expired` has not deleted yet gets `deleted` `true`, a new `chat_deletion` row and `last_delete_seq` + 1, and the operation returns `{}` instead of `not_found`. The storage `### expiry` rule (open-game-works-core/skills/server-core/modules/storage.md:269) says such a row counts as a row that does not exist, and the chat `### admin` rule gives `not_found` when there is no row. Run path: `chat.retentionMs` 10000, send a `World` message, advance the clock 10000 ms without running job `storage_sweep`, call `delete_chat_message` for that seq: 200 `{}`, not 404 `not_found`. The other reads of a message row (`ReportChatMessage`, `DeleteGuildChatMessage`) check `ChatModule.live` (server/core/chat/index.ts:223). The code is unchanged in the range; the batched sweep with a per-table time budget and failed table list in the range only lets expired rows stay longer

## debt

none

## must fix

none

## unknown

- No chat file changed in cf89b7fd..bb137f18. The changes that reach chat are the storage ones: `sweep_expired` in batches with a per-table time budget and failed table list (server/core/storage/rows.ts), and the expiry column index that `register_table` adds (server/core/storage/schema.ts), which gives `chat_message` an extra `(expires_at)` index and `chat_deletion` an `(expires_at)` index. I checked the chat reads that depend on expiry (`ChatModule.live`, `last_live_seq`, `recent_direct_channels`, `select_deletions`) against the new sweep behavior and found no new problem. The batch delete on PostgreSQL by `ctid` with the outer expiry condition skips a `chat_message` row whose `deleted` was updated after the inner select, and a later run deletes it; I did not run this on PostgreSQL
- `ogw core test server chat` passed on this checkout. I did not run the chat tests on PostgreSQL separately, and did not run the storage or routing tests (they are outside this target)
- The routing (`routing.ipRateLimitPerMinute`), ads-reward, client Godot and README changes in the range do not reach the chat module and were not reviewed
