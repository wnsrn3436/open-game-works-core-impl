# review: mission round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | correctness | medium | server/core/mission/index.ts:156 | `add_progress` now reads every `MissionProgressUserState` row of the user with `storage.list_state`, and `list_state` runs `read_value` on each row (`server/core/storage/state.ts:151`-`161`), which throws `ConversionFailed` when the registered item converter returns `FAILED` for a row of a lower contract version (`state.ts:117`, `storage.md:225`). Run path: a user has a stored row of mission B (counter Y) at an older contract version whose converter returns `FAILED`; content calls `add_progress(ctx, X, 1)` for counter X, whose missions do not include B. Before the range only the rows of counter X were read (`get_state` per mission), so the call changed X's missions; now the throw from B's row ends the handler with `INTERNAL` and no progress of any counter can be added for that user until B's row converts. `mission.md` `## API` lists only an unknown counter and an amount less than 1 as the throws of `add_progress`, and `## behavior` limits it to the missions that point to that counter | Read only the rows of the counter's in-window missions: e.g. on `ConversionFailed` from `list_state`, read those missions with `get_state` one by one as before, so a failing row of another counter does not fail the call; add a test with a converter that returns `FAILED` for a mission row of another counter | no | 80 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `server/core/mission/tests/support.ts:294` `claim` takes an optional request ID and passes it to `send` (`server/core/testing/dev/index.ts:103`, used as the request ID at `server/core/testing/dev/request.ts:219`). `server/core/mission/tests/claim.test.ts:200` sends `ClaimMission` twice with one request ID and checks the second response's items equal the first (`GOLD` 100), the UserState after the second request equals the state after the first, the balance is 100 once, the row stays `claimed` `true`, `validate_mission_claim` ran once, and a new request ID ends with `MISSION_ALREADY_CLAIMED`. `ogw core test server mission` passed |
| R1-2 | fixed | `server/core/mission/index.ts:153`-`156` builds one `Map` from a single `storage.list_state` call, made at the first in-window mission, instead of calling `get_state` (one `SELECT` through `raw_item`) per mission. Map keys are `bigint` (`MissionProgressUserState.id: bigint`, `server/generated/contract/core_contract.ts:3018`) and the lookup is `BigInt(row.id)`. Writes go straight to the transaction (`write_item`, `server/core/storage/state.ts:84`), so a later `add_progress` in the same transaction sees them, and `missions_of` (`index.ts:92`) lists each mission once, so no row written in the loop is looked up again. `list_state` is now in `MissionStorage` (`server/core/mission/deps.ts:10`). The query count per call no longer grows with the number of missions of the counter |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: `server/core/mission/tests/claim.test.ts:200` sends `ClaimMission` twice with one request ID and checks the saved response and a single grant; `ogw core test server mission` passed |
| D2 | fixed | none | Same as R1-2: `server/core/mission/index.ts:156` reads the rows with one `list_state` query per `add_progress` call instead of one `get_state` per mission |

## must fix

none

## unknown

- R1-2 / D2: the query count was read from code, not measured; no test counts queries
- R2-1: the throw was read from code (`list_state` → `read_value` → `ConversionFailed`); no run with a registered converter that returns `FAILED` was made
- Changes of the range outside `server/core/mission/` and `server/core/item-ledger/` were not reviewed: they are other modules. The `item-ledger` history change (`server/core/item-ledger/history.ts:99`, `ledger.ts:807`) was read only for its effect on the mission claim grant and does not change the mission path
- `ogw core test server mission` was run once and passed; the dependents of `mission` were not run in this review
