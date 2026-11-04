# review chat round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/chat/admin.ts:96 returns `not_found` when the row is null or `expires_at` ≤ `server-time.clock_now` (`clock_now` is in the `server-time` `## API` for core modules and is now in server/core/chat/deps.ts:13,101). Test server/core/chat/tests/report-delete.test.ts:94. Defect restored in a temporary detached worktree of HEAD 65acb35 (line 96 back to `if (row === null) return 'not_found';`): `ogw core test server chat` fails that test on SQLite and PostgreSQL with `expected [ 200, {} ] to deeply equal [ 404, { error: 'not_found' } ]` |
| R1-2 | fixed | server/core/chat/tables.ts:299 `select_deletions` has `expires_at > $5` in SQL before `LIMIT`, and server/core/chat/index.ts:354 passes the request time. Test server/core/chat/tests/guild.test.ts:126. Defect restored in the temporary worktree (index.ts:354 passes `0n` as `now`): the test fails on both DBs with `expected [ [ 1n, 2n ], 2n ] to deeply equal [ [ 2n ], 2n ]` |
| R1-3 | fixed | server/core/chat/tables.ts:289-296 `list_messages` has `expires_at > $5` and keeps deleted rows; server/core/chat/admin.ts:78 passes `clock_now`. Test server/core/chat/tests/report-delete.test.ts:106. Defect restored in the temporary worktree (admin.ts:78 passes `0n`): the test fails on both DBs with `expected [ [ '1', 'old', false ], …(1) ] to deeply equal [ [ '2', 'removed', true ] ]` |
| R1-4 | fixed | Test server/core/chat/tests/direct.test.ts:83. Defect restored in the temporary worktree by removing the `are_friends` line of `lock_for_send` (server/core/chat/index.ts:304): the test fails on both runs with `expected +0 to be 83` (send succeeded instead of `CHAT_NOT_FRIEND`) |
| R1-5 | fixed | Test server/core/chat/tests/guild.test.ts:114. Defect restored by passing 1000 instead of `chat.s.max_fetch_count` to `select_deletions` (server/core/chat/index.ts:354): the test fails on both runs with `expected [ [ 3n, 1n, 2n ], 3n ] to deeply equal [ [ 3n, 1n ], 2n ]` |
| R1-6 | fixed | Test server/core/chat/tests/direct.test.ts:99. Defect restored by adding to `get_chat_messages` after the `after_seq`/`before_seq` check a `Direct` check that returns `BLOCKED` when the caller's blocked set has the other user or `public_profile.is_active_user` is `false`: the test fails on both runs with `expected 66 to be +0`. By reading, the test also catches a withdrawal-only check: the read at direct.test.ts:110 is after `withdraw(b)` |
| R1-7 | fixed | Tests server/core/chat/tests/report-delete.test.ts:55 and :64. Defect restored by removing the `LIMIT` and `INVALID_INPUT` mapping lines of `report_chat_message` (server/core/chat/index.ts:371-372): the two tests fail on both runs with `expected +0 to be 68` and `expected +0 to be 1` |
| R1-8 | fixed | Test server/core/chat/tests/guild.test.ts:140 asserts one `core` `info` log `guild chat message deleted` with `module`, `user_id`, `guild_id`, `seq`. Defect restored by removing the `chat.log` line of `delete_guild_chat_message` (server/core/chat/index.ts:442): the test fails on both runs with `expected [] to deeply equal [ Array(1) ]` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: server/core/chat/admin.ts:96 and test server/core/chat/tests/report-delete.test.ts:94, which fails with the defect restored |
| D2 | fixed | none | Same as R1-4: test server/core/chat/tests/direct.test.ts:83 fails with the step 6 `are_friends` check removed |
| D3 | fixed | none | Same as R1-5: test server/core/chat/tests/guild.test.ts:114 fails with the `select_deletions` limit raised |
| D4 | fixed | none | Same as R1-6: test server/core/chat/tests/direct.test.ts:99 fails with a block and withdrawal check added to `Direct` `GetChatMessages` |
| D5 | fixed | none | Same as R1-7: tests server/core/chat/tests/report-delete.test.ts:55 and :64 fail with the `LIMIT` and `INVALID_INPUT` mapping removed |
| D6 | fixed | none | Same as R1-8: test server/core/chat/tests/guild.test.ts:140 fails with the delete log removed |
| D7 | fixed | none | Same as R1-2: server/core/chat/tables.ts:299 and test server/core/chat/tests/guild.test.ts:126, which fails with the defect restored |
| D8 | fixed | none | Same as R1-3: server/core/chat/tables.ts:289-296 and test server/core/chat/tests/report-delete.test.ts:106, which fails with the defect restored |

## must fix

none

## unknown

- Mutation runs: two `ogw core test server chat` runs in a temporary detached worktree of HEAD 65acb35 under `worktrees/_core/`, deleted afterwards. Run 1 restored the R1-4..R1-8 defects together, run 2 the R1-1..R1-3 defects together. In each run only the tests named in `## previous` failed, each with an assert that matches its own restored defect; every other chat test passed on SQLite and PostgreSQL. The unchanged HEAD was not run again; the core agent report gives its pass on both DBs
- The R1-6 restoration checked block and withdrawal together in one condition. That a withdrawal-only check is caught was checked by reading the test, not by a run
- `GetChatMessages` leaves out expired `chat_deletion` rows by request time (`server-time.now`, cheat time offset included), while storage `### expiry` names `clock_now`. This follows the chat `### receive` use of request time for message rows, and both are the same outside DEV. It was not counted as a finding
- The core agent's spec proposal on `first_seq` / `last_seq` (taken from the selected rows, expired rows included) is a spec question. The current code matches the current chat `### receive` text, so it is not a finding here
- Client module `ChatCore` and the other dependents of `chat` were not run; only server code changed in the range
