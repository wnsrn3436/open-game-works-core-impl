# review: mission round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/mission/tests/support.ts:293 | `open-game-works-core/skills/server-core/modules/mission.md:88` says a `ClaimMission` sent again with the same request ID returns the response that `idempotency` saved, so the reward is not claimed twice. No mission test sends the same request ID twice: `claim` in `support.ts:293` takes no request ID and passes none to `send`, and `grep -rn "request_id\|same request\|idempot\|retry" server/core/mission/tests/` finds nothing. The rpc has `option (ogw.retry) = true` (`proto/ogw/core.proto:349`). `ClaimAttendance` has the matching test at `server/core/attendance/tests/claim.test.ts:176`. Input D1, unchanged at this commit | Give `claim` in `support.ts` an optional request ID passed to `send`, and add a test in `claim.test.ts` that sends `ClaimMission` twice with the same request ID and checks the second response equals the first, the balance rose once and the mission row stays `claimed` `true` | no | 95 |
| R1-2 | efficiency | medium | server/core/mission/index.ts:144 | `add_progress` calls `read` (line 144) once per in-window mission of the counter in the loop at line 142; `read` calls `storage.get_state` (line 113), which reaches `raw_item` at `server/core/storage/state.ts:73` and runs one `SELECT ... WHERE item_id = $3` per call (`q` at `server/core/storage/core.ts:284` has no cache). The number of queries per `add_progress` call grows with the number of `mission` rows whose `counter` is that counter. `storage.list_state` (`server/core/storage/state.ts:151`, public in `storage.md:28`) reads all rows of the kind in one query. Input D2, unchanged at this commit | Read the `MissionProgressUserState` rows once with `list_state` (or once per `add_progress` call) and look up each mission's row from that result before the round reset and lazy reset | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `server/core/mission/tests/support.ts:293` `claim` still sends no request ID, and no test under `server/core/mission/tests/` sends `ClaimMission` twice with one request ID |
| D2 | open | R1-2 | `server/core/mission/index.ts:142`-`144` still calls `read` → `storage.get_state` → `raw_item` (one `SELECT`) per mission of the counter |

## must fix

none

## unknown

- The commit range `2221156..2221156` is empty, so no changed code was reviewed; only the input debt items were checked against the code at `2221156`
- R1-1: no test was run that sends the same request ID twice to `ClaimMission`, so whether `idempotency` returns the saved response for it was not run; only the absence of the test was checked
- R1-2: the query count was read from code, not measured
