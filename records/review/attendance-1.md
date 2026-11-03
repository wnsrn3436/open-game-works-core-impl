# review attendance round 1

## findings

none

## previous

none

## out of scope

- server/core/attendance/index.ts:234: medium `test evidence`. Before this range, and unrelated to it: no test goes through the failure path of `## error` "reward grant failure (failure of `grant_or_mail`)" → `INTERNAL`. Every `CORE_ERROR_INTERNAL` assert in `server/core/attendance/tests/` is a hook case (hooks.test.ts:114, 140, 205, 232). Run path: in a temporary copy, `default: return CoreError.CORE_ERROR_INTERNAL` was changed to `return 'pass'`, and `server/core/attendance/tests` still passed 32 of 32 on SQLite, so a failed grant answering success with progress saved would not be caught. The data checks block a group item and a bad amount in the reward (tools/data-tool/src/checks/item-ledger.ts), so `test-data` rows are unlikely to reach this path; a test probably needs a `mailbox` that returns a failure value, or the `INVALID_INPUT` of `send_mail` or of the `<once_key>:<k>` collision.
- server/core/attendance/index.ts:220: medium `spec`. Before this range, and unrelated to it: claim step 6 "when `reward` of the next day row is not an empty array" has no test. No row of test-data/data/tables/attendance_reward.csv has an empty `reward`, although the data check allows one with `extra_grant` `true` (tools/data-tool/tests/attendance-checks.test.ts:54). Run path: in a temporary copy, line 220 was removed, and `server/core/attendance/tests` still passed 32 of 32 on SQLite. So a claim of a day that only grants through `grant_attendance_extra` has never run on the server.
- server/core/attendance/index.ts:232: medium `spec`. Before this range, and unrelated to it: the `AlreadyApplied` result, which `mailbox` `## behavior` says "the caller treats as granted", has no test. Run path: in a temporary copy, the branch was changed to return `CORE_ERROR_INTERNAL`, and `server/core/attendance/tests` still passed 32 of 32 on SQLite. Reproducing input for a test: claim, `set_attendance` with day 0, then claim on the same game day, which reuses the `once_key` `attendance:<calendar ID value>:<event_round>:<today>`; server/core/attendance/tests/dev.test.ts:49 moves the clock to the next game day before claiming, so it does not reach this.

## debt

none

## must fix

none

## unknown

- The commit range changes no file of `server/core/attendance/`, of the modules it depends on (`item-ledger`, `mailbox`, `live-event`, `validation`, `storage`, `server-time`, `logging`), of `server/generated/` or of the attendance rows of `test-data/`. What it does reach is the `requirement` change in tools/data-tool/src/corespec.ts and core-spec/validation.json, which puts the enums of the `requirement` header in the core data of a game that uses `attendance` through `validation`. tools/data-tool/tests/attendance-checks.test.ts, coredata.test.ts and corespec.test.ts passed 20 of 20 in a temporary copy. No full game build with `attendance` was run.
- The attendance tests ran only on SQLite in a temporary copy, with `server/build/data` copied from the main checkout `open-game-works-core-impl/` rather than rebuilt at this commit. The PostgreSQL run of `ogw core test` was not done.
- The whole core test suite was not run, and neither were `ogw core test` static checks or `ogw code check`.
- Client `UserStateCore.get_attendance` was not read, because it is outside this target. Only the fact that client/godot/core/user_state_core/tests/test_reset.gd names the fixture `attendance-progress` was checked.
- The inside of the dependency modules (`mailbox`, `item-ledger`, `live-event`, `storage`, `logging`) was not reviewed. They were read only as far as the specs and call sites that `attendance` uses.
