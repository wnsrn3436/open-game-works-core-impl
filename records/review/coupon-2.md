# review coupon round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Each defect the finding names was restored at `server/core/coupon/index.ts:466` in a temporary clone outside the checkout, and `ogw core test server coupon --file server/core/coupon/tests/admin.test.ts` ran on SQLite and PostgreSQL. `picks > settings.max_code_picks` (one pick too many): `accepts a code found on pick 1` failed with `expected 2 to be 1`, `accepts a code found on pick 3` with `expected 4 to be 3`, and `counts coupon.maxCodePicks per code` with `expected 200 to be 409`, on both databases. `picks + 1 >= settings.max_code_picks` (one pick too few): the two `accepts a code found on pick` cases failed with `expected 409 to be 200`, and `counts coupon.maxCodePicks per code` with `expected 2 to be 3`, on both databases. The test also accepts a code found on the Nth pick, as the finding asked (`server/core/coupon/tests/admin.test.ts:101`). The same file passes on both databases on the code without a defect. |
| R1-2 | fixed | The test the finding names is gone. Its replacements at `server/core/coupon/tests/admin.test.ts:101` and `:117` set no explicit limit, so they use the 60 s run default (`TEST_TIMEOUT_MS`, `testTimeout` in `vitestTestOptions` of the harness run), and each starts one test server instead of two. The file passed on SQLite and PostgreSQL in a run started at load average 30. That is one run, so it does not reproduce the two failures of round 1. |

## out of scope

- server/core/coupon/index.ts:469: medium `test evidence`. No coupon test fails when `codes.has(code)` is removed from the pick loop, so the rule of `coupon.md:80` against a code picked earlier in the same `create_coupon` is checked only within one lookup round. Run path: `new_codes` keeps accepted codes in `codes` and retries codes found stored in a later round, and `picked` is new each round. Run on a temporary clone with `} while (picked.has(code));`: all coupon test files pass on SQLite and PostgreSQL (`ogw core test server coupon`). A temporary scripted test with alphabet `ABC`, length 1, `coupon.maxCodePicks` 3, stored code `A`, `count` 2 and secure random values 0, 1, 1, 2 passes on the code as it is and fails with that defect on both databases: `expected [ 'B' ] to deeply equal [ 'B', 'C' ]`, so `create_coupon` succeeds with fewer than `count` codes. The test at `server/core/coupon/tests/admin.test.ts:117` covers only the same-round `picked.has(code)` branch. `new_codes` did not change in the range.
- server/core/coupon/tests/admin.test.ts:99: medium Explicit 10 s limit, lower than the 60 s run default, the same cause as R1-2. It timed out on PostgreSQL under load in round 1, when it was at line 72, and is listed there as D1 of `records/review-debt/coupon.json`. It was read here and did not time out in this round's runs. It existed before the range.
- server/core/coupon/tests/admin.test.ts:145: medium Explicit 10 s limit, lower than the 60 s run default, the same cause as R1-2. It timed out on PostgreSQL under load in round 1, when it was at line 99, and is listed there as D2 of `records/review-debt/coupon.json`. It was read here and did not time out in this round's runs. It existed before the range.
- server/core/coupon/index.ts:372: medium When `storage.lock_game_row` is `FAILED` in step 4 (also line 375), `RedeemCoupon` returns `INTERNAL` and nothing in `coupon` leaves an `error` log, while `server/core/mailbox/index.ts:381` throws on the same failure. This is D3 of `records/review-debt/coupon.json`. `coupon` code did not change in the range. Read from code, not run.

## debt

none

## must fix

none

## unknown

- The R1-2 timeout was not reproduced under sustained load, and the load fell during this round (load average 30 when the first run started, under 10 about 10 minutes later). The evidence for `fixed` is that the limit is gone, not a repeat of the failing run.
- Each restored defect was run once.
- A third restored defect, `pending.push(0)` in place of `pending.push(picks)` (the pick count restarting each lookup round), gave no test result. The run did not end within about 10 minutes, with one test process near 100% CPU, and it was stopped by hand, so its `fail` status comes from the stop. The cause of the hang was not checked. It is expected from the defect, since `A` and `B` stored would make `new_codes` retry without end, but no assertion shows that this defect is caught. This defect is not named by a finding.
- `ogw core test server coupon` on the unchanged checkout passed in about 16 s, which may be a kept result of the same key rather than a new run. The whole module was run without a kept result only on the temporary clone with the `codes.has(code)` defect above, where every test passed.
- The explicit 10 s limits at `server/core/coupon/tests/admin.test.ts:99` and `:145` were not run under load in this round.
- D1 to D3 of `records/review-debt/coupon.json` are not in the input `## debt`, so they were not judged. D1 and D2 still name their old lines (`:72` and `:99`). Line 72 now holds an unrelated assert, and the limits are at `:99` and `:145`, so the two lines above name the current positions.
- The code of `item-ledger`, `mailbox`, `storage`, `server-time`, `logging` and `routing` was read only at the lines cited, and none of it changed under `server/core/` in the range.
- Changes of the range outside coupon (`tools/data-tool`, `client/godot/core/message_core`, review records of other targets) were not reviewed.
