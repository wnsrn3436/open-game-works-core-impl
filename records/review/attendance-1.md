# attendance review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/attendance/index.ts:234 | Debt D1 remains. The `## error` row "reward grant failure (failure of `grant_or_mail`)" → `INTERNAL` has no test: every `CORE_ERROR_INTERNAL` assert in server/core/attendance/tests/ is a hook case (hooks.test.ts:114, 140, 205, 232). `grant_or_mail` returns a failure value for `UNKNOWN_ITEM`, `INVALID_AMOUNT`, `UNSUPPORTED_ITEM` and `INVALID_INPUT` (server/core/mailbox/index.ts:53, 301-302), and no test makes the mailbox return one, so changing `default: return CoreError.CORE_ERROR_INTERNAL` to `return 'pass'` (answer success with progress saved after a failed grant) is not caught. server/core/attendance/ and test-data/data/tables/attendance_reward.csv have not changed since the commit the debt was recorded against (`git log` shows only 301b3dd) | Add a test where `grant_or_mail` returns a failure value (a `mailbox` module in the test env that returns e.g. `UNKNOWN_ITEM`, or an `INVALID_INPUT` from `send_mail`), and assert `INTERNAL` with progress and balance unchanged | no | 90 |
| R1-2 | spec | medium | server/core/attendance/index.ts:220 | Debt D2 remains. Claim step 6 "when `reward` of the next day row is not an empty array" has no test: every row of test-data/data/tables/attendance_reward.csv has a non-empty `reward` (the only `extra_grant` `true` row, `[attendance_extra]` day 2, gives `[attendance_gold] 10`), so removing line 220 is not caught and a day that grants only through `grant_attendance_extra` never runs | Add an `attendance_reward` row with an empty `reward` and `extra_grant` `true` to test-data and a test that claims it: `grant_or_mail` is not called (no ledger change, no mail), `items` is empty, `mailed` is `false`, `grant_attendance_extra` runs and progress is saved | no | 90 |
| R1-3 | spec | medium | server/core/attendance/index.ts:232 | Debt D3 remains. The `AlreadyApplied` result of `grant_or_mail` (server/core/mailbox/index.ts:300), which `mailbox` `## behavior` says the caller treats as granted, has no test; replacing the branch with `return CoreError.CORE_ERROR_INTERNAL` is not caught. Reproducing input: claim, `set_attendance` with day 0, then claim on the same game day, which reuses `once_key` `attendance:<calendar ID value>:<event_round>:<today>`; server/core/attendance/tests/dev.test.ts:49 moves the clock to the next game day before the second claim, so it does not reach this branch | Add a test with that run order and assert the claim succeeds with `day` 1, progress saved and no second grant | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | server/core/attendance/tests/ still has no test of the `grant_or_mail` failure path; the only `CORE_ERROR_INTERNAL` asserts are hook cases (hooks.test.ts:114, 140, 205, 232), and index.ts:233-234 is unchanged |
| D2 | open | R1-2 | test-data/data/tables/attendance_reward.csv has no row with an empty `reward`; index.ts:220 is unchanged and unreached by tests |
| D3 | open | R1-3 | No test claims twice on the same game day after `set_attendance` day 0; dev.test.ts:49 still advances to the next game day; index.ts:231-232 is unchanged |

## must fix

none

## unknown

- The commit range 7a4390b..7a4390b is empty, so no changed code was reviewed; only the input `## debt` items were checked
- The restore runs of the debt items were not repeated in this round; the debt evidence was taken as still valid because server/core/attendance/, server/core/mailbox/index.ts grant path and test-data/data/tables/attendance_reward.csv have no commit after 301b3dd
- Tests were not run in this round
