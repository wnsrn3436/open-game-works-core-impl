# review chat round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/chat/admin.ts:92 | Input debt D1. `delete_chat_message` reads the row with `T.read_message` (no `expires_at` condition) and only checks `row === null`, so a message row with `expires_at` ≤ request time that `sweep_expired` has not deleted yet gets `deleted` `true`, a new `chat_deletion` row and `last_delete_seq` + 1, and the operation returns `{}`. storage `### expiry` (open-game-works-core/skills/server-core/modules/storage.md:269) says such a row counts as a row that does not exist, and chat `### admin` gives `not_found` when there is no row. Run path: `chat.retentionMs` 10000, one `World` message, clock advanced 10000 ms with no `storage_sweep`, `delete_chat_message` of that seq returns `{}` instead of `not_found`. `ReportChatMessage` (server/core/chat/index.ts:367) and `DeleteGuildChatMessage` (server/core/chat/index.ts:440) check `Chat.live` | Return `not_found` when the row is null or `expires_at` ≤ request time (deleted rows stay a success with no change), and add a test with an expired, unswept row | no | 90 |
| R1-2 | spec | medium | server/core/chat/tables.ts:294 | Input debt D7. `select_deletions` has no `expires_at` condition, and `GetChatMessages` (server/core/chat/index.ts:354-356) returns its rows in `deleted_seqs` and raises `last_delete_seq` from them, so an expired `chat_deletion` row that `sweep_expired` has not deleted is delivered, and the response differs by sweep timing. storage `### expiry` (open-game-works-core/skills/server-core/modules/storage.md:269) says such a row counts as a row that does not exist also before it is deleted. Run path: `chat.retentionMs` 10000, `routing.storageSweepIntervalMs` 3600000, two guild messages, seq 1 deleted, clock advanced 10000 ms, `GetChatMessages` `after_seq` 1, `after_delete_seq` 0 returns `deleted_seqs` [1] | Add `expires_at > now` to `select_deletions` and a test with an expired, unswept `chat_deletion` row | no | 85 |
| R1-3 | spec | medium | server/core/chat/tables.ts:289 | Input debt D8. `list_messages` selects through `select_messages` with no `expires_at` condition, and admin `list_chat_messages` (server/core/chat/admin.ts:77) returns those rows, so an operator reads the text of a message whose `chat.retentionMs` has passed until `sweep_expired` deletes the row. storage `### expiry` (open-game-works-core/skills/server-core/modules/storage.md:269) says such a row counts as a row that does not exist, and chat `### admin` only adds deleted messages. Run path: `chat.retentionMs` 10000, `routing.storageSweepIntervalMs` 3600000, one `World` message, clock advanced 10000 ms, `list_chat_messages` returns that row | Leave out rows with `expires_at` ≤ request time in `list_messages` (keep deleted rows), and add a test with an expired, unswept row | no | 85 |
| R1-4 | test evidence | medium | server/core/chat/index.ts:304 | Input debt D2. The `CHAT_NOT_FRIEND` of `### send` step 6 after the channel lock is reached by no test. The only `CHAT_NOT_FRIEND` assert, server/core/chat/tests/direct.test.ts:41, is answered at step 1 (`check_direct_peer`, server/core/chat/index.ts:245-248) for a stranger. server/core/chat/tests/withdraw.test.ts:141-170 removes the friend link only together with a withdrawal, which ends in `USER_NOT_FOUND`. Removing the `are_friends` check at line 304 fails no chat test | Add a test: friends A and B, another transaction holds the `Direct` channel key, removes the friend link and commits while A's send waits on the lock; result `CHAT_NOT_FRIEND` and no message row | no | 85 |
| R1-5 | test evidence | medium | server/core/chat/index.ts:354 | Input debt D3. `### receive` limits `chat_deletion` rows to `chat.maxFetchCount` in ascending `delete_seq` and sets `last_delete_seq` to the largest selected. Every `deleted_seqs` assert (server/core/chat/tests/guild.test.ts:93-108, server/core/chat/tests/withdraw.test.ts:87) runs with fewer deletions than `chat.maxFetchCount`, so dropping the limit of `select_deletions` fails no chat test | Add a test: `chat.maxFetchCount` 2, three deletions, `after_seq` non-zero, `after_delete_seq` 0; expect the first two seqs and `last_delete_seq` 2, then the third on the next request | no | 85 |
| R1-6 | test evidence | medium | server/core/chat/index.ts:333 | Input debt D4. `### receive` says `GetChatMessages` on a `Direct` channel does not look at blocks or the other user's withdrawal. The `Direct` reads in server/core/chat/tests/direct.test.ts:59-75 and server/core/chat/tests/send-rules.test.ts run with no block and no withdrawal (the block test at server/core/chat/tests/direct.test.ts:78-91 reads a `World` channel), so a block or `is_active_user` check added to this path fails no chat test | Add a test that reads a `Direct` channel with `GetChatMessages` after a block between the two users and after the other user's `Withdraw`, and expects a success response | no | 80 |
| R1-7 | test evidence | medium | server/core/chat/index.ts:371 | Input debt D5. `### report` step 4 maps `LIMIT` to `REPORT_LIMIT` and `INVALID_INPUT` to `INVALID_REQUEST`, and no test goes through either path. server/core/chat/tests has no `REPORT_LIMIT`, `block-report.maxReportsPerWindow` or `block-report.maxEvidenceBytes`; server/core/block-report/tests/report.test.ts tests `REPORT_LIMIT` only through `ReportUser`. Swapping or removing lines 371-372 fails no test | Add a test: `block-report.maxReportsPerWindow` 1, two `ReportChatMessage` of different messages by one user; the second is `REPORT_LIMIT` and makes no report. Add a test for the `INVALID_INPUT` path | no | 85 |
| R1-8 | test evidence | medium | server/core/chat/index.ts:442 | Input debt D6. `### delete` step 6 leaves the deleting user ID, the guild ID and the seq in an `info` log, and no test checks that log. The log text `guild chat message deleted` is only in server/core/chat/index.ts, and server/core/chat/tests/guild.test.ts:65-108 asserts only response codes and rows. Removing line 442 fails no chat test | Add an assert on the `info` log line with the user ID, guild ID and seq after a successful `DeleteGuildChatMessage` | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | server/core/chat/admin.ts:92-95 still uses `T.read_message` with only a null check and no expiry check; code unchanged in the range |
| D2 | open | R1-4 | server/core/chat/index.ts:304 unchanged; the only `CHAT_NOT_FRIEND` assert is server/core/chat/tests/direct.test.ts:41, answered at step 1 |
| D3 | open | R1-5 | server/core/chat/index.ts:354 unchanged; no test has more deletions than `chat.maxFetchCount` |
| D4 | open | R1-6 | server/core/chat/index.ts:333-361 unchanged; no `Direct` `GetChatMessages` test after a block or withdrawal |
| D5 | open | R1-7 | server/core/chat/index.ts:371-372 unchanged; no `REPORT_LIMIT` or `INVALID_INPUT` path test in server/core/chat/tests or for `ReportChatMessage` elsewhere |
| D6 | open | R1-8 | server/core/chat/index.ts:442 unchanged; no test checks the log |
| D7 | open | R1-2 | server/core/chat/tables.ts:294-300 still has no `expires_at` condition |
| D8 | open | R1-3 | server/core/chat/tables.ts:289-291 still selects with no `expires_at` condition |

## must fix

none

## unknown

- The commit range is empty (6733e19..6733e19), so no change was reviewed; only the input debt items were checked against the current code.
- The run paths of R1-1, R1-2 and R1-3 come from the input debt items and were checked by reading the code; they were not run again in this round.
- The claims that removing a line fails no test (R1-4, R1-5, R1-7, R1-8) were checked by searching the tests, not by running the test suite on a changed copy.
