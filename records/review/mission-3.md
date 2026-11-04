# review: mission round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | efficiency | medium | server/core/mission/index.ts:155 | The range (`983d610`) changes the loop of `add_progress` back from one `storage.list_state` call to `read(ctx, row)` per in-window mission. `read` (`index.ts:111`) calls `storage.get_state` with one item ID, and `get_state` reaches `raw_item` (`server/core/storage/state.ts:73`), which runs one `SELECT ... WHERE user_id = $1 AND kind = $2 AND item_id = $3`. Run path: one `add_progress(ctx, counter, amount)` call runs one `SELECT` per in-window `mission` row whose `counter` is that counter (`missions_of`, `index.ts:92`); the growing amount is the number of those `mission` rows in data (e.g. achievement tiers of one counter). This is the problem of R1-2 / D2, which round 2 judged fixed and which was removed from the debt list. It cannot be fixed inside `mission` without breaking R2-1: `list_state` is the only multi-item read of the `storage` `## API` (`storage.md:27`-`28`), it reads and converts every `MissionProgressUserState` row of the user (a `FAILED` conversion of another counter's row throws, R2-1), and its query rows and decoded values grow with all mission rows of the user, not only the counter's | Add to `storage` `## API` an operation that reads several items of one list kind by a list of item IDs in one query with the same read conversion as `get_state` (the `get_states` proposal of `records/1793826603976-review-fix-mw2m1m14c8abfc.md` `## spec proposals`), then read the counter's in-window missions with one call of it | yes | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | `server/core/mission/index.ts:151`-`155` reads each in-window mission of the counter with `read` (`get_state` by item ID), so a row of another counter is not read; `list_state` is removed from `MissionStorage` (`server/core/mission/deps.ts:10`). Test `server/core/mission/tests/progress.test.ts:123` stores the `[mission_other]` row (counter `[mission_count_other]`, `test-data/data/tables/mission.csv:10`) at contract version + 1 with a registered `migration_converter` row, checks `add_progress` on `[mission_count_other]` is `INTERNAL` (the read really fails), and that `add_progress` on `[mission_count_sum]` and `[mission_count_max]` changes their missions. `ogw core test server mission` passed on this checkout. Restored the defect in a temporary copy (a `git clone --shared` of this checkout under `worktrees/_core/`, with `server/core/mission/index.ts` and `deps.ts` taken from `6692a139`): `ogw core test server mission --file server/core/mission/tests/progress.test.ts` failed that test in the sqlite and postgresql runs with `expected 8 to deeply equal [ 370677779, 396416435, …(2) ]` (14 of 16 passed). The copy was deleted |

## out of scope

none

## debt

none

## must fix

none

## unknown

- R3-1: the query count was read from code, not measured; no test counts queries
- The `FAILED` conversion of R2-1 was run only through a row of a later contract version (the rollback case); a row of a lower contract version was not run, because the core test data contract version is 1
- Changes of the range outside `server/core/mission/` (`client/godot/core/badge_core/`, `server/core/public-profile/`, `records/`) were not reviewed: they are other modules or records
- The dependents of `mission` were not run in this review; `ogw core test server mission` was run once and passed
