# review coupon round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | `lock_use_row` (`server/core/coupon/index.ts:370`) calls `write_error` with `ctx.user_id`, `ctx.request_id` and `request` `core/RedeemCoupon` (`write_error` at `index.ts:317`) before it returns false. Both step 4 lock sites use it: `index.ts:379` for the `unique` code row and `index.ts:382` for the `shared` coupon row. This matches `skills/core/SKILL.md` `## error handling` and the parallel `count_redeem_attempt` `FAILED` row (`coupon.md:140`). I restored the defect in a temporary clone under `worktrees/_core/` (deleted after the run) by replacing the `write_error` line in `lock_use_row` with a comment. `ogw core test server coupon` then failed `server/core/coupon/tests/lock.test.ts:41` on SQLite and PostgreSQL, and `lock.test.ts:64` on PostgreSQL (`expected [] to have a length of 1 but got +0`). The same suite passes on this checkout on both databases |
| R2-2 | fixed | New test `server/core/coupon/tests/admin.test.ts:133`: alphabet `ABC`, length 1, `coupon.maxCodePicks` 3, stored code `A`, `count` 2, secure random `0, 1, 1, 2`. It expects 4 picks and codes `['B', 'C']`. Trace on the current code: round 1 picks `A` and `B`, `A` is stored, so `B` is accepted. Round 2 picks `B`, which `codes.has` rejects, then `C`. I restored the defect in a temporary clone under `worktrees/_core/` (deleted after the run) with `server/core/coupon/index.ts:477` changed to `} while (picked.has(code));`. `ogw core test server coupon` then failed that test on SQLite and PostgreSQL (`expected 3 to be 4`). It passes on this checkout |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D3 | fixed | none | Same as R2-1 in `## previous`. Both step 4 `lock_game_row` `FAILED` paths now write one `error` log before `INTERNAL` (`server/core/coupon/index.ts:370`, `:379`, `:382`), and tests that fail without the log cover it. The `coupon.md` `## error` row for this condition is still missing. It is a harness spec change, and the core agent filed it as a spec proposal in `records/1793855641407-review-fix-mw33bzgf550f54.md`. The code follows `skills/core/SKILL.md` `## error handling` |
| D4 | fixed | none | Same as R2-2 in `## previous`. With `codes.has(code)` removed at `server/core/coupon/index.ts:477`, `admin.test.ts:133` fails on SQLite and PostgreSQL |

## must fix

none

## unknown

- `coupon.md` `## error` still has no row for the step 4 `lock_game_row` `FAILED` condition, and `## spec changes` is `none`. The spec proposal in the core agent report is still open. This review does not decide whether to add that row
- On SQLite, the only test that reaches step 4 is the stubbed `lock_game_row` `FAILED` case (`lock.test.ts:41`). The real lock-wait case (`lock.test.ts:64`) runs only on PostgreSQL, because the SQLite test holder holds the whole database. I did not check the SQLite real-wait path separately
- I did not review the rest of coupon again outside the range changes (`server/core/coupon/index.ts`, `tests/admin.test.ts`, `tests/lock.test.ts`) and the code they call (`write_error`, `testing.hold_game_row_lock`, `storage_module`). Like in round 2, I did not check whether `admin-api` logs the `create_coupon` lock failure (`server/core/coupon/index.ts:511`, which returns `internal`)
- I ran only `ogw core test server coupon`, not the dependent modules (`routing`, `testing`). The core agent reports that those pass
