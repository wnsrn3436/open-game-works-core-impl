# review mission round 1

## findings

none

## previous

none

## out of scope

- server/core/mission/tests/support.ts:293: medium `open-game-works-core/skills/server-core/modules/mission.md:88` says a `ClaimMission` sent again with the same request ID returns the response that `idempotency` saved, so the reward is not claimed twice, and no mission test goes through this. `claim` in `support.ts` passes no request ID to `send`, and `grep` for `request_id` and `same request` over `server/core/mission/tests/` finds nothing. `ClaimAttendance` has this test at `server/core/attendance/tests/claim.test.ts:176`. The retry flag is on (`proto/ogw/core.proto:349`), but no test was run that sends the same request ID twice, so whether the behavior holds for `ClaimMission` was read from code, not run. It existed before the range.
- server/core/mission/index.ts:144: medium `add_progress` runs one `SELECT` per in-window mission of the counter. The loop at line 142 calls `read`, `read` calls `storage.get_state` at line 113, and `get_state` reaches `raw_item` at `server/core/storage/state.ts:73`, which queries one `item_id`. The growing amount is the number of `mission` rows that point to that counter, per `add_progress` call. `storage.list_state` (`server/core/storage/state.ts:151`) reads all rows of the kind in one query. Read from code, not run. It existed before the range.

## debt

none

## must fix

none

## unknown

- `git diff` of the range shows no change under `server/core/mission` or under the code of `item-ledger`, `mailbox`, `live-event`, `validation`, `storage`, `server-time` and `logging`. The range changes that reach mission were checked as below, and the rest of the range was not reviewed.
- `tools/data-tool/src/corespec.ts` (enums of the `requirement` header in core data): `ogw core test tools data-tool` passes, including `tools/data-tool/tests/mission-check.test.ts`. The diff has no change under `server/generated`, so the core test data gives mission the same generated code. Data tool output for a real game that uses `mission` was not run.
- `core-spec/routing.json` no longer lists `idempotency.responseRetentionMs`: `core-spec/idempotency.json:13` lists it, `server/core/idempotency/index.ts:118` reads it, and `routing` depends on `idempotency`. `core-spec/validation.json` and the added settings keys were checked only by the passing runs of `ogw core test server mission`, whose `modules_without` reads `core-spec/`.
- `ogw core test server mission` was run once and passes. It was not run with PostgreSQL separately from what that command runs. The core tests of modules that depend on mission were not run.
- `server/core/mission/index.ts` was read whole against `## behavior`, `## hook`, `## error` and `## DEV` of the mission spec, and no defect was found. This was reading, not mutation: no defect was restored in a temporary copy, so whether the mission tests fail on such defects was not measured. No row of `test-data/data/tables/mission.csv` has both a `reset` and a `live_event`, so the order of round reset and lazy reset on one row was checked only by reading `read` at `server/core/mission/index.ts:113`.
- The code of `item-ledger`, `mailbox`, `validation`, `logging` and `routing` was not read. `storage` and `live-event` were read only at the lines cited and at `is_in_active_window`, `round_to_write`, `is_round_reset`. Their behavior was taken from their specs and from the mission tests.
- A data change that sets a `reset` on a mission whose stored `reset_at` is 0 (that row never resets, by the lazy reset rule of `server-time`) was read but not run, and was not judged. The specs read do not set that case.
