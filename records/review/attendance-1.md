# review attendance round 1

## findings

none

## previous

none

## out of scope

- server/core/attendance/index.ts:250: medium the server start check of `## data` of the attendance spec ("When there is a row whose `reward` is an empty array and `extra_grant` is `false` ... the server does not start", skills/server-core/modules/attendance.md:159) is not implemented: `complete_start` only checks `extra_grant` rows against a missing `grant_attendance_extra`, nothing else in `server/core` or the core test data invariants (`test-data/data/invariants.csv:7-9` has only `order_column` and `child_exists`) rejects such a row, and `grant_reward` (server/core/attendance/index.ts:220) returns `pass` for an empty `reward`, so a day row `[cal],1,,false` starts the server and `ClaimAttendance` succeeds, writes progress and grants nothing. No test of `server/core/attendance/tests/` covers the `## test` item "When there is a row that violates the data rules, the server does not start". The attendance code is unchanged in the commit range, so this existed before it

## debt

none

## must fix

none

## unknown

- The commit range changes no file under `server/core/attendance/`. The review covered the changes in the range to the code attendance calls: `storage` (`db/meter.ts` counting adapter and DB meter, `db/postgres.ts`, `tx.ts` seed provider, `index.ts`), `item-ledger` (`ledger.ts` separate `onceKeyRetentionMs` for `once_key` rows, which the per-game-day `once_key` `attendance:<calendar>:<event_round>:<today>` does not depend on), `logging` (`index.ts` metrics on `write`), `routing` (`pipeline.ts` step detail texts, min version check, `duration_ms` clock; `server_process.ts` worker threads, where attendance keeps no in-memory state) and `start.ts`. No change there alters what attendance calls or relies on. `server-time`, `mailbox`, `live-event` and `validation` have no code change in the range (validation only tests)
- `ogw core test server attendance` was run twice on 910daf01 and failed both times only in the PostgreSQL run, each time in different tests and with `INTERNAL` (error code 8) outside attendance code: `core/cheat/DevLogin failed with error code 8: handler: INTERNAL`, `DevLogin ... rate limit: rate counter transaction failed`, `RunCoreTest failed with code 8`, and claim results of 8 where the test expected 0 or 1. Run 1 failed in claim, dev, hooks and progress tests; run 2 in claim, errors and hooks tests. The SQLite run reported no failure. The cause was not reproduced: the job output gives no server log lines, and the base commit 85f6b36d cannot be tested for comparison (`ogw core test` refuses it: its `core-settings.json` lacks keys the current specs define). Whether the in-range storage or PostgreSQL adapter changes (`db/meter.ts`, `db/postgres.ts`) or the host's PostgreSQL under load cause it is not checked, so no finding is written for it
