# review matchmaker round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/matchmaker/tests/rooms.test.ts:145 counts the `randomInt` calls with alphabet `A`, length 1, `matchmaker.roomCodeMaxPicks` 3. The defect was restored in a temporary copy outside the checkout, at server/core/matchmaker/realtime.ts:295, and rooms.test.ts ran with vitest on SQLite. `pick <= settings.room_code_max_picks`: `gives up on a room code after exactly matchmaker.roomCodeMaxPicks picks` fails with `expected [ 1, 1, 1, 1 ] to deeply equal [ 1, 1, 1 ]`. `pick < settings.room_code_max_picks * 2`: the same test fails with `expected [ 1, 1, 1, 1, 1, 1 ] to deeply equal [ 1, 1, 1 ]`. `pick < 100` also fails that test. `pick < 1` fails that test with `expected [ 1 ]` and fails rooms.test.ts:157 `picks a colliding room code again and takes a free code on the last of matchmaker.roomCodeMaxPicks picks` with `ROOM_CREATE failed: [[91,14]]`, so the second test checks that a colliding code is picked again. The only other failures in those runs were the 2 tests of rooms.test.ts that need PostgreSQL, which also fail on the unmodified copy because that run gives no `OGW_POSTGRESQL` |

## out of scope

- server/core/matchmaker/matching.ts:69: medium `efficiency`. `collect` keeps walking the whole queue after the collected headcount reached `max_players`. This is the problem of round 1, already item D1 of records/review-debt/matchmaker.json. The commit range does not change matching.ts, and the loop is unchanged at that line. It was not measured again in this round

## debt

none

## must fix

none

## unknown

- Mutation runs and the 8 repeated runs of the two new tests (`-t 'roomCodeMaxPicks picks'`, all passed) used vitest directly in a temporary copy on SQLite, because `ogw core test` run by this agent always tests this checkout. The defects were not run on PostgreSQL. Rooms and the `randomInt` calls of `new_room_code` are in memory and are not reached through the DB, but this was read from the code, not run
- The unmodified checkout passed `ogw core test server matchmaker` (the whole module on SQLite and PostgreSQL, job mw14ar3ie63363) and `ogw core test server matchmaker --file server/core/matchmaker/tests/rooms.test.ts` (job mw148q9we14019). The core tests of modules that depend on matchmaker were not run, because the range changes only a test file in this module
- The `Test timed out in 30000ms` of round 1 was not reproduced. The test that timed out no longer exists and the new tests have no own time limit. The 2 runs of this round and their PostgreSQL parts passed, which does not show the cause of that timeout. The host load of that run was not recreated
- Only `server/core/matchmaker/tests/rooms.test.ts` is in the range for this target. The other changed files of the range belong to other targets (coupon, MessageCore, data-tool, review records) and were not reviewed. The implementation of matchmaker was read only where these tests reach it. `spec` and `test evidence` of the other `## test` items were not checked item by item
- `auth`, `session`, `admin-api`, `storage`, `server-time`, `logging`, `p2p-signaling`, `validation`, `game-update` were not read in this round, because the range changes no call to them. The other non-test callers of `randomInt` are server/core/auth/account.ts:79 and server/core/coupon/code.ts:48. Whether a scripted value can reach them was not traced through the test harness. The evidence that it does not is that the two new tests assert the exact `randomInt` limits and passed in every run
- Of the defining documents, only `### room`, the settings row of `matchmaker.roomCodeMaxPicks` and the room code items of `## test` of the matchmaker spec were read in full. server-core SKILL.md, core SKILL.md, command.md and the testing spec were searched for rules on mocks, random and test time limits and no rule on them was found; they were not read in full
