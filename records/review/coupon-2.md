# review coupon round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | server/core/coupon/index.ts:372 | Input item D3, still present. In step 4 of `RedeemCoupon`, `check_use_limit` returns `CORE_ERROR_INTERNAL` when `storage.lock_game_row` is `FAILED` (line 372 for the `unique` code row, line 375 for the `shared` coupon row), and nothing writes an `error` log. Run path: another transaction holds the row past `storage.userLockWaitMs` (or PostgreSQL aborts with `55P03`/`40P01`/`40001`). `lock_row` in `server/core/storage/tx.ts:380` returns `FAILED` without a log, which matches `storage.md` `## error` (log `none` for "exceeding the game row lock wait, PostgreSQL deadlock, serialization failure"). `redeem` (`server/core/coupon/index.ts:394`) returns the number as is. The routing handler path (`server/core/routing/pipeline.ts:521`) calls only `this.fail` for a handler `CoreError`, which writes the `request` line with the error code and no `error` log. `error_log` in `pipeline.ts:123` runs only for thrown exceptions (`pipeline.ts:220`). `skills/core/SKILL.md:104` says the module that detects a failure leaves an error log. Coupon already does this for the parallel case "the user transaction of `count_redeem_attempt` is `FAILED`" (`coupon.md` `## error`, `index.ts` `count_redeem_attempt` `write_error`). `server/core/mailbox/index.ts:381` throws on the same lock failure, so routing logs it. I read this from the code and did not run it | Call `write_error` (with user ID and request ID) before returning `INTERNAL` at both lock failures. Add a `## error` row to `coupon.md` for the step 4 lock failure (`INTERNAL`, `INTERNAL`, `error` log) | no | 85 |
| R2-2 | test evidence | medium | server/core/coupon/index.ts:470 | Input item D4, still present. No coupon test fails when `codes.has(code)` is removed from the pick loop of `new_codes`, so `coupon.md:81` ("collides with ... a code picked earlier in the same `create_coupon`, it picks again") is checked only for codes picked in the same lookup round (`picked`). Accepted codes from earlier rounds (`codes`) are not covered. Restored in a temporary clone of this checkout under `worktrees/_core/` (deleted after the run), with line 470 changed to `} while (picked.has(code));`. `ogw core test server coupon` on that dirty clone printed `coupon pass` for both databases. `admin.test.ts:119` and `admin.test.ts:103` (`it.each`) have no stored code that sends one code into a second round while another code was accepted in the first round | Add an `admin.test.ts` case that uses `create_scripted`. Use alphabet `ABC`, length 1, `coupon.maxCodePicks` 3, stored code `A` and `count` 2, with secure random values that pick `A`, `B` in round 1 and then `B`, `C` in round 2. Expect codes `['B', 'C']`; with the defect restored, the result is `['B']` | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Commit 4cf6c1f removed the explicit `}, 10_000);` from that test (`git show 4cf6c1f -- server/core/coupon/tests/admin.test.ts`). `grep -n "10_000\|timeout" server/core/coupon/tests/*.ts` finds no explicit limit, so the test uses the 60 s run default |
| D2 | fixed | none | Same as D1. 4cf6c1f removed the second `}, 10_000);`, and no explicit limit remains in `admin.test.ts` |
| D3 | open | R2-1 | `server/core/coupon/index.ts:372` and `:375` still return `CORE_ERROR_INTERNAL` with no `write_error` on a `lock_game_row` `FAILED`, and `coupon.md` `## error` still has no row for it |
| D4 | open | R2-2 | With `codes.has(code)` removed at `server/core/coupon/index.ts:470`, `ogw core test server coupon` passes on SQLite and PostgreSQL |
| D5 | fixed | none | Same as D1. The limit at the old line 145 was the one 595edfb kept and 4cf6c1f removed. No explicit limit remains in `admin.test.ts` (the test is now at line 138 with the default limit) |

## must fix

none

## unknown

- The commit range is empty (`9dced3e..9dced3e`) and there are no spec changes, so this round has no findings from changes. I did not review the rest of coupon again. The only checks were the input `## debt` items and the previous round's file, which has no findings and no `open` rows.
- R2-1 is read from the code. No lock wait over `storage.userLockWaitMs` was run to observe the missing `error` log. The `create_coupon` lock failure at `server/core/coupon/index.ts:504` returns `internal` to `admin-api`. I did not check whether `admin-api` logs that.
- For R2-2 I did not write or run the scripted test given in the fix. The evidence is only that the coupon tests pass with the defect restored.
- In the restored-defect run, `ogw core test server coupon` printed `coupon pass` twice. I took these as the SQLite and PostgreSQL runs, the same as round 1. An earlier try from a clone in the scratchpad ran against the main checkout of `open-game-works-core-impl/`, because `resolveCoreImpl` uses the cwd only under `worktrees/_core/`. I discarded that run and did not use it as evidence.
