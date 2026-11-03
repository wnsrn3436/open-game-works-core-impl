# review coupon round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/coupon/tests/admin.test.ts:74 | The test added for `coupon.maxCodePicks` does not pin the number of picks that `coupon.md:80` sets. Run on a temporary copy, SQLite, whole `admin.test.ts`, 17 of 17 pass with each defect at `server/core/coupon/index.ts:466`: `picks > settings.max_code_picks` (one pick too many) and `picks + 1 >= settings.max_code_picks` (one pick too few). With one pick too few, `maxCodePicks` 1 refuses before any pick, so the `refused` 409 holds, and 999 picks still fill the 16 codes of the `many` server. With one pick too many, `maxCodePicks` 1 allows 2 picks per code, and all 16 codes still differ only about 1 run in 2586, so the 409 also holds. No other coupon test sets this key. | Assert the exact bound with a run that does not depend on chance: with stored codes taking the whole code space (alphabet `AB`, length 1, `count` 2), a `unique` `create_coupon` with `maxCodePicks` N makes exactly N picks and is `conflict`, counted at the secure random call. Also assert that a code found on the Nth pick is accepted | no | 95 |
| R1-2 | correctness | medium | server/core/coupon/tests/admin.test.ts:83 | The new test lowers its time limit to 10 s (the run default is 60 s, `testTimeout` of the harness run) and starts two test servers. `ogw core test server coupon --file server/core/coupon/tests/admin.test.ts` ran twice at load average 22 to 30, and the PostgreSQL run failed this test both times with `Test timed out in 10000ms`. In the second run the only failures were the three tests with the explicit 10 s limit (lines 72, 83, 99), and every test on the 60 s default passed. With the three limits removed on a temporary copy, the whole file passes against a throwaway PostgreSQL (one worker). There the first test took 10751 ms, which shows a PostgreSQL test server start can pass 10 s under this load, and this test took 3865 ms. Input: this test on PostgreSQL while other test runs load the machine. The behavior under test is not at fault: the test fails on its time limit. | Remove `10_000` at line 83 so the test uses the run default | no | 85 |

## previous

none

## out of scope

- server/core/coupon/tests/admin.test.ts:72: medium Explicit 10 s limit, lower than the 60 s run default. It timed out in the second PostgreSQL run under load, the same cause as R1-2. It existed before the range.
- server/core/coupon/tests/admin.test.ts:99: medium Explicit 10 s limit, lower than the 60 s run default. It timed out in both PostgreSQL runs under load, the same cause as R1-2. It existed before the range.
- server/core/coupon/index.ts:372: medium When `storage.lock_game_row` is `FAILED` in step 4 (also line 375), `RedeemCoupon` returns `INTERNAL` and nothing leaves an `error` log. Run path: another transaction holds the row past `storage.userLockWaitMs`, `lock_row` in `server/core/storage/tx.ts:380` returns `FAILED` without a log, `check_use_limit` returns the number, and `finish` in `server/core/routing/pipeline.ts` only calls `fail` for a handler `CoreError`, which writes the `request` log line with `error_code` and no `error` log. `skills/core/SKILL.md` `## error handling` says the module that detects a failure leaves an error log, and `server/core/mailbox/index.ts:381` throws on the same failure instead of returning a value. `coupon.md` `## error` has no row for this condition. Read from code, not run.

## debt

none

## must fix

none

## unknown

- PostgreSQL: only `admin.test.ts` was run. The other coupon test files were run only on SQLite, on a temporary copy (50 of 50 pass with the code unchanged). The changes of the range touch only `new_codes` and `admin.test.ts`.
- The first PostgreSQL run also failed two tests on the 60 s default with `the connect to PostgreSQL went over its time limit`. These are attributed to machine load, because they did not repeat in the second run or in the one-worker run. That cause was not checked separately.
- The cause in R1-2 was checked by removing the limits with one worker on a throwaway PostgreSQL, not by rerunning the harness run in parallel with the limits removed. The durations of the failing harness runs are not available, because a `--file` run keeps no test record.
- Each defect of R1-1 was run once. The 1 in 2586 is computed, not measured.
- The `lock_game_row` `FAILED` path of step 4 was read only. No coupon test goes through it.
- `routing` was read only around steps 13 to 17 of `server/core/routing/pipeline.ts`. The call site of `count_redeem_attempt` was checked only through the coupon tests. The code of `item-ledger`, `mailbox`, `storage`, `server-time` and `logging` was read only at the lines cited, and none of it changed in the range.
- D1 to D4 of `records/review-debt/spec-coupon.json` are not in the input `## debt`, so they were not judged.
- Changes of the range outside coupon (`matchmaker`, `routing` server image tests, client modules, `tools/data-tool`) were not reviewed. `routing.storageSweepIntervalMs` minimum 1 was checked only for use in coupon tests and `testing` dev code: coupon tests do not use it, and `testing` only lists its type in `server/core/testing/dev/setting_types.ts:450`.
