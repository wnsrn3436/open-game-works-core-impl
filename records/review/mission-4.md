# review: mission round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | open | The range `e8987c8..5cfab30` changes no file under `server/`, `benchmark/`, `tools/` or `test-data/` (`git diff --name-only` on those paths: 0 files). `add_progress` still calls `read(ctx, row)` per in-window mission of the counter (`server/core/mission/index.ts:155`), and `read` (`index.ts:111`) still calls `storage.get_state` with one item ID, so one call runs one `SELECT` per in-window `mission` row of that counter. `MissionStorage` still picks only `get_state` (`server/core/mission/deps.ts:10`), and the `storage` `## API` still has no multi-item read by item IDs (only `get_state` and `list_state`, `open-game-works-core/skills/server-core/modules/storage.md:27`-`28`). The core agent report (`records/1793827306778-review-fix-mw2mgobe38da10.md`) states no code change for R3-1 because it needs the `get_states` spec change |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range changes, outside `records/`, only `client/godot/core/payment_core/tests/test_recovery.gd` and `client/godot/core/scene_core/` (PaymentCore and SceneCore, other targets; none of these files refers to `mission`); they were not reviewed. The `records/` files of other targets were not reviewed
- I did not run the mission tests, because no code reached by `mission` changed in the range. R3-1 was judged from the code, and the query count is still not measured
- The `fix test proof` `fail` noted in the core agent report is a result of `ogw code check` and is not judged here
- The places in `## unknown` of `records/review/mission-3.md` (the `FAILED` conversion of a row of a lower contract version, the dependents of `mission`) remain unchecked
