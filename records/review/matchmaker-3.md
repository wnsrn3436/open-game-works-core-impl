# review: matchmaker round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | open | Not fixed: the core agent report left it for the spec decision, the range changes no implementation file, and input `## spec changes` is `none`. Reproduced again on the code of the range end, with a test file added to a temporary copy, on SQLite: `ROOM4` room A, B, C, fake `turn` failure `timeout`, `p2p-signaling.turnTimeoutMs` 1500, A `ROOM_START`, wait for the `issue_relays` call, close A's socket, B `ROOM_START`. B got no `ROOM_FAILED` and received two `MATCH_FOUND` frames with different `match_id`. In the first match (A, B, C), B and C have `left_at` written and A has `disconnected_at` written. The second match has B and C with both 0. `host_error` at server/core/matchmaker/realtime.ts:577 and `create_match` are unchanged |
| R2-2 | fixed | server/core/matchmaker/tests/rooms.test.ts:680 now runs `ROOM_START` and host `MATCH_REQUEST` with both members bound and kill switch `MATCH_REQUEST` on, and expects `ROOM_FAILED`(`ROOM_BUSY`) with the match still running. Restored the defect in a temporary copy: in `host_error` (server/core/matchmaker/realtime.ts:577) the `member_in_match` check moved after the kill switch line. `rooms.test.ts` on SQLite then fails the test at server/core/matchmaker/tests/rooms.test.ts:653 with `expected [ [ 5, 18 ] ] to deeply equal [ [ 91, 18 ] ]`, in addition to the 2 PostgreSQL tests that fail without the mutation because the run gives no `OGW_POSTGRESQL`. Without the mutation, that test passes |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Tests were run in a temporary copy with vitest directly, on SQLite only, with the built data of the main checkout, because that run gave no PostgreSQL. `server/core/matchmaker/tests`: 133 pass and 4 fail, and all 4 are PostgreSQL tests that need `OGW_POSTGRESQL`. So the PostgreSQL runs and `ogw core test` itself were not checked here. The core agent's report states a pass on both DBs. R2-1 and the R2-2 mutation were also run on SQLite only.
- The tests of the modules that depend on `matchmaker` were not run, because the only code change of the range is the one test at server/core/matchmaker/tests/rooms.test.ts:653.
- The only code or test change of the range is that test, so no other implementation or test file was read for findings, except `host_error`, the room start and party request paths, and `create_match` in server/core/matchmaker/realtime.ts for R2-1 and R2-2. The range's other changes are review records and `records/review-debt/matchmaker.json`.
- `records/review-debt/matchmaker.json` holds D1, D2 and D3 while input `## debt` is `none`. They were not decided or reproduced here and are not repeated in `## out of scope`.
- R2-1 still needs the spec decision named in records/1793771795454-review-fix-mw1pevi68a0694.md. This round did not check any fix direction for it.
