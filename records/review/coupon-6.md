# review coupon round 6

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

- Commit range `c815c85..1ed6afe` changes no file under `server/core/coupon/`. I checked the changes in the dependencies that coupon calls (`storage`, `mailbox`). `server/core/storage/tx.ts` `lock_row` now returns `FAILED` at once on a broken transaction, also for a row it locked before. Coupon calls `lock_game_row` once per `RedeemCoupon` (`server/core/coupon/index.ts:373-381`) and once per `create_coupon` (`index.ts:510`), so the result does not change. In `server/core/mailbox/mail_input.ts`, `send_mail` now takes only `undefined` as a left-out field and refuses `null`. Coupon passes every field with a value of its type (`index.ts:339`: `args: []`, `expire_ms: 0n`, `no_expiry: false`, a string `once_key`) and `grant_or_mail` with `args` `[]` (`index.ts:335`), so its mail input is still accepted
- `## spec changes`, `coupon.md`: `after_code` lost "used as given, without normalization" and the `## test` item "An `after_code` `ab` returns the empty list". `list_codes` (`index.ts:564`) still uses `after_code` as given through `code_bound_after` (`server/core/coupon/code.ts`), which matches "returns only codes after that code in byte order" with no code format check. The test `server/core/coupon/tests/admin.test.ts:207-220` still checks byte order for lowercase and other characters, and still matches the changed definition. I found no coupon behavior that the other changed definitions reach (the `item-ledger` order of history rows and hook lists, `logging` `log` level, `mailbox` `once_key` prefix order, `storage` `get_states` caller, `lock_game_row` key, `run_user_changes` throw): coupon does not call `get_states` or `run_user_changes`, and does not rely on history row or hook list order
- Not written as a finding, because nothing in the defining documents sets the result: since the range, `server/core/storage/db/sqlite.ts` fails a statement whose `string` parameter holds U+0000 on SQLite too (`storage.md:307`). A `create_coupon` whose `memo` holds U+0000 now throws at the `INSERT_COUPON` query on both DBs (`index.ts:515`), so it answers 500 `internal` by the `admin-api` throw handling, not `bad_request`. On PostgreSQL it did so before the range too. `coupon.md` does not say what a `memo` with U+0000 gives. I did not run this path
- The double `error` log of a thrown after hook on a broken transaction, which the round 5 review wrote in `## unknown`, is unchanged; the range does not touch it
- Run: `ogw core test server coupon` in this checkout at `1ed6afe` gave `coupon pass` (both runs). I did not run the suites of modules that depend on coupon
