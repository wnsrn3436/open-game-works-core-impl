# review fix: chat round 1

## done

- module `chat` (server). Commit d4b334f on `agent/mw2hnqh8fc79be`
  - `delete_chat_message` returns `not_found` for a message row whose `expires_at` ≤ `server-time.clock_now` (the admin operation runs in a game transaction, so the time is `clock_now`). A deleted row that has not expired is still a success that changes nothing
  - `list_chat_messages` leaves out rows whose `expires_at` ≤ `clock_now`. Deleted rows are still listed
  - `GetChatMessages` `deleted_seqs` / `last_delete_seq` select only `chat_deletion` rows with `expires_at` > request time
  - `chat` now also takes `server-time.clock_now`, which is in the `server-time` `## API` (`server/core/chat/deps.ts:13`, `:101`)
- Last `ogw core test server chat auth matchmaker rating routing testing`: every module `pass` (SQLite and PostgreSQL runs)
- `ogw code check core`: type check, lint, dependency, secret all `pass`
- No engine-specific implementation rules document was written. `## <engine> build` of `tools/ogw.md` was not written

## spec proposals

- `chat` `### receive`: `last_seq` and `first_seq` are taken from the selected rows, and the selection does not leave out rows whose `expires_at` ≤ request time. So before and after `sweep_expired` deletes an expired row, `first_seq` (and `last_seq` with `after_seq` 0 / `before_seq`) can differ, which goes against `storage` `### expiry` ("counts as a row that does not exist, also before it is deleted"). Proposal: say that the selection leaves out rows whose `expires_at` ≤ request time. Not changed, because the current spec text says to leave them out only after selection ("From the selected rows, leaves out ... messages with `expires_at` ≤ request time")

## review

- R1-1: fixed. `server/core/chat/admin.ts:96` (`not_found` when the row is null or expired). Test `server/core/chat/tests/report-delete.test.ts:94` (expired, unswept row → 404 `not_found`; `deleted` stays false, no `chat_deletion` row, `last_delete_seq` stays 0)
- R1-2: fixed. `server/core/chat/tables.ts:299` (`expires_at > now` in `select_deletions`), `server/core/chat/index.ts:354`. Test `server/core/chat/tests/guild.test.ts:126` (two deletions, the first expired and unswept: `deleted_seqs` [2], `last_delete_seq` 2, both rows still stored)
- R1-3: fixed. `server/core/chat/tables.ts:289` (`list_messages` with `expires_at > now`), `server/core/chat/admin.ts:78`. Test `server/core/chat/tests/report-delete.test.ts:106` (expired row left out, deleted live row kept, both rows still stored)
- R1-4: fixed (test). Test `server/core/chat/tests/direct.test.ts:83` (PostgreSQL: another transaction holds the `Direct` channel key, deletes the friend link rows and commits once the send waits; result `CHAT_NOT_FRIEND`, no message row)
- R1-5: fixed (test). Test `server/core/chat/tests/guild.test.ts:114` (`chat.maxFetchCount` 2, three deletions: [3, 1] with `last_delete_seq` 2, then [2] with 3)
- R1-6: fixed (test). Test `server/core/chat/tests/direct.test.ts:99` (`Direct` `GetChatMessages` succeeds after a block both ways of reading, and after the other user's `Withdraw`)
- R1-7: fixed (test). Tests `server/core/chat/tests/report-delete.test.ts:55` (`block-report.maxReportsPerWindow` 1: second report `REPORT_LIMIT`, one report stored) and `:64` (`INVALID_INPUT` by text over `block-report.maxEvidenceBytes` and by an unknown `reason_id` → `INVALID_REQUEST`, no report)
- R1-8: fixed (test). Test `server/core/chat/tests/guild.test.ts:140` (one `core` `info` log `guild chat message deleted` with `module` chat, `user_id` the deleting user, `guild_id`, `seq`)
- Checked by mutation, then restored: with the three code fixes removed, the R1-1, R1-2, R1-3 tests fail; with the step 6 `are_friends` check removed, the `select_deletions` limit raised to 1000, the `LIMIT`/`INVALID_INPUT` mapping removed, the delete log removed and a block/withdrawal check added to `Direct` `GetChatMessages`, the R1-4..R1-8 tests fail, on both SQLite and PostgreSQL runs

## unverified

- The client modules that `ogw core dependents chat` lists (e.g. `ChatCore`) were not run, as only server code changed
