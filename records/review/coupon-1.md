# review coupon round 1

## findings

none

## previous

none

## out of scope

- server/core/coupon/index.ts:352: medium `run_hook` catches every throw of `on_coupon_redeemed` and leaves its own `error` log `on_coupon_redeemed threw`, also when the throw is an `item-ledger` hook failure that `item-ledger` already logged. Core `## error handling` (skills/core/SKILL.md) says failures of the same cause are logged only once, and `item-ledger` `## hook` (skills/server-core/modules/item-ledger.md:189) sets the logs of a hook failure in a request as one `item-ledger` `error` log plus the `routing` step 13 `error` log. Reproduced on SQLite and PostgreSQL with a temporary test in a scratch worktree: `on_coupon_redeemed` calls content `add_items`, and `validate_item_change` throws on that call. `RedeemCoupon` is `INTERNAL` with three `error` lines of one request ID: `hook validate_item_change threw`, `on_coupon_redeemed threw`, `request transaction failed`. The coupon line was already a second line for the same cause before this range (item-ledger logged and rethrew, and coupon logged again). The range adds the `routing` line, which the spec sets. So the extra line comes from code that this range does not change

## debt

none

## must fix

none

## unknown

- The commit range 625ae189..aca0d897 changes no file under `server/core/coupon/`. I reviewed the changed code that coupon calls or that runs inside a coupon request. `storage`: `fail_transaction`, `not_failed` in `user_state_of` and `any_state_of`, and the `body` rule that a marked transaction is `FAILED`. `item-ledger`: a hook failure calls `fail_transaction`, a misuse throws without a log, `once_key` rows are kept as SHA-256, and history `source` is read as the enum value. coupon's `once_key` `coupon:<coupon ID>` is well formed ASCII and goes through `grant_or_mail` → `add_items` unchanged. `mailbox` keeps its own `mailbox_once_key` table, which is not hashed. `session` `end_session`, `logging` metrics, `iap`, `admin-api` and `auth` do not reach coupon. `mailbox`, `server-time` and `routing` have no changes in the range. Apart from the logging item above, none of these changes alters an observable coupon result. A validation hook that throws during the step 5 grant, or inside `on_coupon_redeemed`, still gives `INTERNAL` with no use record, no `used_count` change and no items. The temporary test confirmed this on both DBs
- `ogw core test server coupon` passed (`coupon pass` on both runs) on a clean scratch worktree of HEAD aca0d897. The temporary reproduction test was removed with that worktree
- I read coupon code that the range does not change and that the changes above do not reach, but I did not re-review it as a whole target, because the commit range is not `none`
