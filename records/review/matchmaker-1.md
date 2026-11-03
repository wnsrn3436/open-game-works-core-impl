# review matchmaker round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | `test evidence` | medium | server/core/matchmaker/tests/rooms.test.ts:130 | `### room` sets that no room is created after `matchmaker.roomCodeMaxPicks` picks. The new test only sees whether 16 rooms in 16 codes hit `ROOM_BUSY` with value 1 and all get a code with value 1000, so it does not check the pick count. Restored in a temporary copy: `pick <= settings.room_code_max_picks` at server/core/matchmaker/realtime.ts:295 (3 runs), and `pick < settings.room_code_max_picks * 2` (1 run). `gives up on a room code after matchmaker.roomCodeMaxPicks picks` passed in all 4 runs on SQLite. With 2 picks per room, 16 rooms all get a code about 4 times in 10000, so the test passes these defects almost always. Control: `pick < 100` makes the test fail, so the runs used the copy | Add a test that counts the picks: alphabet `A`, length 1, `matchmaker.roomCodeMaxPicks` 3, `vi.mock` of `node:crypto` wrapping `randomInt`, and after the first room the second `ROOM_CREATE` is `ROOM_BUSY` with exactly 3 `randomInt(1)` calls. Tried in the temporary copy on SQLite: it passes on the current code and fails with `expected 4 to be 3` on the `<=` defect | no | 90 |

## previous

none

## out of scope

- server/core/matchmaker/matching.ts:69: medium `efficiency`. `collect` keeps walking the whole queue after the collected headcount reached `max_players`, though no later entry can fit, and `run_queue` calls it once per match, so one `matchmaker_tick` over one queue is quadratic in the queue size and blocks the event loop of all `/realtime` connections and requests of that server instance. Run path: `run_tick` to `run_queue` to `collect`, growing amount: entries of one queue. Entries pile up behind an e0 that has no partner until its `match_wait` ends, because step 5 ends the queue at e0. Measured with `run_queue` directly, `max_players` 2, same ratings: 8000 entries 130 ms, 16000 entries 580 ms, 32000 entries 2583 ms. With `if (count === rule.max_players) break;` after the placement in a temporary copy: 32000 entries 229 ms, and `matching.test.ts` and `queue-rules.test.ts` pass on SQLite

## debt

none

## must fix

none

## unknown

- `gives up on a room code after matchmaker.roomCodeMaxPicks picks` failed once with `Test timed out in 30000ms` in the PostgreSQL run of `ogw core test server matchmaker --file server/core/matchmaker/tests/rooms.test.ts` (job mw1331clc77e7e). 3 later runs of the same unmodified file passed on both DB kinds. In the failing run, other tests of that file failed with PostgreSQL connect time limits and the host load average was over 20, so load is the likely cause, but it was not reproduced or isolated, so it is not a finding. This test is the only test in `server/core/matchmaker/tests/` with its own time limit, 30000 ms, which is half of the 60000 ms that the other tests of this file ran with in the same run
- Mutation runs and the whole `server/core/matchmaker/tests/` run used vitest directly in a temporary copy on SQLite, because `ogw core test` run by this agent always tests this checkout. The tests marked PostgreSQL did not run there: 4 of 132 failed for that reason (helpers.test.ts 1, results.test.ts 1, rooms.test.ts 2) and the other 128 passed. Only `rooms.test.ts` ran on PostgreSQL, through `ogw core test`. The other test files of the module did not run on PostgreSQL in this review
- The pick count test of R1-1 was tried only on SQLite
- The commit range changes only `matchmaker.roomCodeMaxPicks` in this module (realtime.ts, shared.ts, frames.test.ts, rooms.test.ts, core-spec, settings). The other code of the module was read, but not every `## test` item of the spec was matched to a core test, and `spec` and `test evidence` of code outside the range were not checked item by item
- `p2p-signaling`, `auth`, `session`, `admin-api`, `storage`, `server-time`, `logging`, `validation`, `game-update` were read only as far as matchmaker calls them. The implementation of those modules was not reviewed
