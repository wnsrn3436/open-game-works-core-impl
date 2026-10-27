# review attendance round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range cf89b7fd2768..bb137f183f87 changes no file under `server/core/attendance/`, `proto/`, `server/generated/` or `test-data/`, and does not change `attendance.md`. The changes that reach code attendance calls or shares were checked: `storage` (`sweep_expired` batch deletes with a per-table time budget and a failed table list, `register_table` adds an expiry column index and `CREATE INDEX IF NOT EXISTS`, settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`, PostgreSQL pool wait code `POOL` added to the lock failure codes), `routing` (`storage_sweep` error log per failed table, `routing.ipRateLimitPerMinute` default 300, `adUnits` environment game settings key) and `ads-reward`. attendance calls only `get_state`, `put_core_state`, `delete_core_state`, `with_hook_change_source` and `check_hook_output` of `storage`, none of which changed; `AttendanceUserState` is a core UserState kind with no expiry column and attendance registers no table, so the changes cause or reveal no attendance problem
- The attendance tests (`server/core/attendance/tests/`, 7 files, 32 tests) were run on SQLite at bb137f1 with vitest and all passed. They were run with the server build data of `open-game-works-core-impl/server/build/data` because this checkout has no `server/build/data`; that build data was not checked to equal a build of `test-data/` at bb137f1
- The attendance tests were not run on PostgreSQL: no PostgreSQL connection string was available to this review
- Client `UserStateCore.get_attendance` is a client core module and was not reviewed
