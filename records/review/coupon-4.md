# review coupon round 4

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R4-1 | spec | medium | server/core/coupon/index.ts:370 | The changed spec says that when the step 4 lock is `FAILED`, the `error` log comes from `routing` (`open-game-works-core/skills/server-core/modules/coupon.md:138`), and the test item expects "one `error` log, which `routing` leaves" (`coupon.md:198`). On PostgreSQL a `FAILED` `lock_game_row` breaks the transaction, so storage must make `run_request_transaction` `FAILED` (`storage.md:151`), and routing step 13 then writes `error` log `request transaction failed` (`routing.md:122`, `server/core/routing/pipeline.ts:701`). But `lock_use_row` still writes its own `error` log (`coupon <table> row lock failed`, with `request` `core/RedeemCoupon`) through `write_error` before it returns false. Run path: in a temporary clone of this checkout, I added a probe test that holds `coupon_coupon` with `testing.hold_game_row_lock` under `storage.userLockWaitMs` 200 and then calls `RedeemCoupon`. With `ogw core test server coupon --file`, the PostgreSQL run left exactly one new `error`/`error` line, and it was coupon's `coupon coupon_coupon row lock failed`, not the routing line. Today the count is 1 only because of the storage defect under `## out of scope`. Once storage returns `FAILED` as its spec says, the same failure gets two `error` logs, which breaks "one `error` log" (`coupon.md:198`) and "Failures of the same cause are logged only once" (`open-game-works-core/skills/core/SKILL.md:104`) | Remove the `write_error` call from `lock_use_row`. Keep returning `INTERNAL`, and let storage's `FAILED` make routing write the log. Do this together with the storage fix under `## out of scope`, because without that fix no `error` log is written at all | no | 85 |
| R4-2 | test evidence | medium | server/core/coupon/tests/lock.test.ts:24 | `lock_errors` keeps only the `error` lines whose message contains `row lock failed`, which is coupon's own message. So the PostgreSQL test (`lock.test.ts:64`) asserts that coupon left the log. It does not check that `routing` left it (`coupon.md:198`), and it does not fail when a second `error` log is written for the same failure. The stubbed test at `lock.test.ts:41` mocks `lock_game_row` to return `FAILED` without breaking the transaction. That state cannot happen in storage: SQLite takes no lock (`storage.md:194`), and on PostgreSQL a `FAILED` breaks the transaction. This test also asserts coupon's own log, which the changed spec no longer defines | Count every new `error` log line of the request. Assert that there is exactly one, and that it is routing's line for the failed request transaction, with that user ID, request ID and `request` `core/RedeemCoupon`. Replace or drop the stubbed case so that it does not require a coupon-written log | no | 85 |

## previous

none

## out of scope

- server/core/storage/tx.ts:212: medium In `run_user`, a function that returns a failure code makes it return that code even when the transaction is broken (`state.broken` set by `mark_broken` after a PostgreSQL lock abort in `lock_row`, `tx.ts:387`). It rolls back without returning `FAILED`. The same applies to `run_game` at `tx.ts:263`. `storage.md:151` says that after such an abort, "When the function ends, by return or by throw, ... the operation that opened that transaction is `FAILED`", and `routing.md:122` relies on that ("step 13 handles that `FAILED` instead"). Run path: the probe of R4-1 on PostgreSQL. `lock_game_row` of `coupon_coupon` is `FAILED`, coupon returns `INTERNAL`, `run_request_transaction` returns that code, and routing `finish` (`server/core/routing/pipeline.ts:701`) never takes the `FAILED` branch, so no `request transaction failed` `error` log was written. The same path also lets a content handler that catches a lock throw and returns a `GameError` respond with that `GameError` instead of `INTERNAL`

## debt

none

## must fix

none

## unknown

- No coupon code or test changed in the commit range. Following the spec changes, I checked coupon's uses of the changed definitions:
  - the step 4 lock and its log (R4-1, R4-2)
  - the `lock_game_row` key types: `coupon_coupon` is always a `bigint` key at `index.ts:382` and `:511`, and `coupon_code` is always a `string` key at `index.ts:379`
  - change source `Coupon` and empty `args` passed to `mailbox`
- Coupon does not call `exchange_items`, `read_db`, `get_user_record(s)`, `read_public_state` or `mail_input_from_json`, so those spec changes do not reach it
- I ran only the probe test file, in a temporary clone under `worktrees/_core/` that I deleted after the run. I did not run the whole coupon suite or the suites of dependent modules, because no code changed in the range
- I did not check that routing's `request transaction failed` line carries the user ID and request ID in a real run, because the storage defect under `## out of scope` keeps that branch from running. By code, `error_log` (`server/core/routing/pipeline.ts:123`) sets `user_id`, `request_id` and `request` from the exchange
- As in rounds 2 and 3, I did not check whether `admin-api` logs the `create_coupon` lock failure (`server/core/coupon/index.ts:511`, which returns `internal`)
