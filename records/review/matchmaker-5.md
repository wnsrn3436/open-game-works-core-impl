# review: matchmaker round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R4-1 | fixed | The two tests at server/core/matchmaker/tests/rooms.test.ts:837 (`ROOM4`, new host `ROOM_START`) and :855 (`BOTH`, new host `MATCH_REQUEST`) now hold A's member rating resolution on a gate, close A's socket and send the new host's frame before the gate opens, which is the window of open-game-works-core/skills/server-core/modules/matchmaker.md:146 and :151. Restored the defect in a temporary copy by moving `room.making_match = true` (server/core/matchmaker/realtime.ts:738) to after the `resolve_members` line. On SQLite and on PostgreSQL, `rooms.test.ts` then fails exactly these two tests (2 failed, 41 passed), at the intended assertion: :840 with `expected [] to deeply equal [ [ 91, 18 ] ]` and :858 with `expected [] to deeply equal [ [ 91, 4 ] ]`, so the new host's frame was not refused. Without the mutation, `server/core/matchmaker/tests` passes 145 of 145 on both DBs, and `describe('a match being made')` passed 6 of 6 repeated runs on each DB. Three more mutations in temporary copies, each failing on both DBs. Removing `room.making_match` from `host_error` (realtime.ts:579) fails :837, :855 and the two tests that hold the match creation part. Skipping `host_error` in `party_request_error` while `making_match` is set fails only the two `MATCH_REQUEST` tests (at :858 and :886). Leaving the mark set after a failed resolution fails :837, the test `takes a ROOM_START again after member rating resolution failed` and four `member rating resolution` tests |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Tests ran in temporary copies with vitest directly, with the built data folder of the main checkout, whose HEAD is the same commit (when that folder was built was not checked), and with a throwaway PostgreSQL container of the `tools.postgresql` image. `ogw core test` itself was not run, and the vitest options were copied from the tool only in part (`include`, `exclude`, `globals`, `pool`; a 60 s time limit of my own). records/1793773130453-review-fix-mw1q7hlh292b56.md reports `ogw core test server matchmaker rating routing testing` as passing.
- The tests of the modules that depend on `matchmaker` (server `rating`, `routing`, `testing`; client `BootstrapCore`, `QACore`, `RealtimeCore`, `UnitTestCore`) were not run. The range changes no implementation file: its only code changes are the tests in server/core/matchmaker/tests/rooms.test.ts and the export of `WAIT_MS` in server/core/matchmaker/tests/helpers.ts.
- The hold in the new tests is a gate on a spy of `run_rollback_transaction`, not a real lock wait, and no real client ran against a real server.
- The exit of `room_start` where `live(client)` is null after a successful member rating resolution was not run. The range does not change it.
- `records/review-debt/matchmaker.json` holds D1 to D5 while input `## debt` is `none`. They were not decided or reproduced again here, and the range changes no implementation that could affect them, so they are not repeated in `## out of scope`.
- `realtime.ts` was read only around `making_match`, member rating resolution and `host_error`. judge.ts, matching.ts, records.ts, results.ts, shared.ts and websocket.ts have no change in the range and were not read. Of the input definition documents, only matchmaker.md was read, at the room section and the start of `## test`, because the range changes tests only.
