# review: mission round 6

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `add_progress` now filters the counter's missions by `in_window` first, returns at once when none is in its window, and reads the stored rows of the rest with one `storage.get_states` call (`server/core/mission/index.ts:153-160`). It no longer calls `get_state` per mission; `get_state` is now called only by `read` (`index.ts:121`), which `get_progress` and `ClaimMission` use for one mission each. `MissionStorage` picks `get_states` (`server/core/mission/deps.ts:10`). `get_states` reads the listed item IDs with one query (`server/core/storage/state.ts:168-187`, `storage.md:88`), and only the counter's in-window mission IDs are passed, so a failing read conversion of another counter's row still cannot fail the call (`storage.md:407`). A listed ID with no row adds no value, and `stored.get(row.id) ?? null` hands that to `current_of` as a missing row, which is the first value, as `read` did before. The added test `server/core/mission/tests/progress.test.ts:153` counts zero `get_state` calls and one `get_states` call with the four sum mission IDs, checks that progress adds up to 3 + 4 = 7, and checks that a counter with no missions makes no read. `ogw core test server mission` passes at `33446d8` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- `ogw core test server mission` was the only test run. I did not run the dependents of `mission` (`routing`, `testing`) myself. The core agent report says they pass, and `ogw review run` runs them after each fix
- I did not check that `get_states` runs one SQL statement. I checked this by reading `server/core/storage/state.ts:168` and relied on the storage tests for it. The mission test counts storage calls, not statements
- The other changes in the range (`client/godot/core/payment_core/`, `records/`) were not reviewed. Mission does not call that code and that code does not call mission
- The places in `## unknown` of `records/review/mission-3.md` are still unchecked: the `FAILED` conversion of a row with a lower contract version, and the dependents of `mission`
