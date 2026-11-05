# review coupon round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R4-1 | fixed | `lock_use_row` (`server/core/coupon/index.ts:369-373`) no longer calls `write_error`. It returns false on a `FAILED` `lock_game_row`, and `check_use_limit` returns `INTERNAL` (`index.ts:378`, `:381`). `body` in `server/core/storage/tx.ts:195-208` now returns `FAILED` when the function ends by return on a broken transaction (`state.broken`, set by `mark_broken` from `lock_row`, `tx.ts:387`). So `run_request_transaction` is `FAILED`, and routing `finish` writes the one `error` log `request transaction failed` (`server/core/routing/pipeline.ts:701-703`, `routing.md:212`). This matches `coupon.md` error row "the lock of step 4 is `FAILED`" and its `## test` item. Run: in a temporary clone of this checkout at `c815c85` (deleted afterwards), `ogw core test server coupon --file server/core/coupon/tests/lock.test.ts` gave `coupon pass` on SQLite and PostgreSQL. The test asserts exactly one new `error`/`error` line, routing's, with that user ID, request ID and `request` `core/RedeemCoupon`, for both the `shared` coupon row and the `unique` code row |
| R4-2 | fixed | `server/core/coupon/tests/lock.test.ts:50-58` now counts every new `error`/`error` log line instead of coupon's own message. It asserts length 1 and `message` `request transaction failed` with that user ID, request ID and `request`. The stubbed `lock_game_row` case is removed. Defect restored: in the temporary clone I put `lock_use_row` back to its round 4 form (`if (storage.lock_game_row(...) !== 'FAILED') return true; write_error(\`coupon ${table} row lock failed\`, ...); return false;`). `ogw core test server coupon --file server/core/coupon/tests/lock.test.ts` then failed in the PostgreSQL run: `RedeemCoupon row lock failure > answers INTERNAL with one error log, the routing line of the failed request transaction, ...` with `coupon_coupon: expected [...] to have a length of 1 but got 2` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Checked but not written as a finding, because my confidence is below 80 that coupon code can fix it: the after hook path when the hook throws because the transaction broke. Before this range, `run_hook` (`server/core/coupon/index.ts:343-355`) caught the throw, wrote `on_coupon_redeemed threw`, and coupon returned `INTERNAL`, which only rolled back. This could happen, for example, after a content `lock_game_row` past `storage.userLockWaitMs` on PostgreSQL (`server/core/storage/tx.ts:420`) or after a failed statement. After the storage change in this range (`tx.ts:205-207`), the same path also ends `FAILED`, so routing adds `request transaction failed` (`routing.md:212`). That is two `error` logs for one cause. Both logs are required by the defining documents (`core/SKILL.md:94` for the hook throw, `routing.md:212` for `FAILED`), and coupon cannot tell that the transaction broke. Whether "Failures of the same cause are logged only once" (`core/SKILL.md:104`) should rule here is a question for the spec. The same applies to every server module that catches an after hook throw. I did not run a probe for this path
- I ran only `server/core/coupon/tests/lock.test.ts`, on restored and unmodified code. I did not run the whole coupon suite or the suites of dependent modules. Per the core agent report, those runs were done after the fix, and `ogw agent merge` requires them
- `create_coupon` (`server/core/coupon/index.ts:510`): on PostgreSQL, a `FAILED` `lock_game_row` now makes `run_game_transaction` `FAILED` instead of returning `internal`. By code (`server/core/admin-api/index.ts:430-432`, `admin-api.md:155`, `:267`), both give 500 `internal` with `audit` and `error` logs, so the result does not change. I did not run this path
- Storage code outside coupon's use (`run_savepoint` after an abort, the `friend` and `guild` test changes, and the modules outside coupon changed in this range) is outside this target, and I did not review it beyond the paths coupon calls
