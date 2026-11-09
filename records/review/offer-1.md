# review offer round 1

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

- The commit range 625ae189..91754637 changes no file of `server/core/offer/`, `server/core/live-event/`, `server/core/server-time/` or `server/core/validation/`, no `OfferUserState` field of `server/generated/contract/core_contract.ts`, and no offer data table, data tool check or `core-spec/offer.json`. Input `## spec changes` is `none`
- Checked the changes of the range in the dependency modules that offer calls: `server/core/storage/core.ts`, `server/core/storage/tx.ts` and `server/core/storage/index.ts` (new `fail_transaction`, the `failed` flag of `TxState`, the `not_failed` guard added to `user_state_of` and `any_state_of`, the `FAILED` result of `body` for a marked transaction), `core-spec/storage.json` (adds `fail_transaction`) and `server/core/logging/metrics.ts` (comment only). `get_state`, `put_core_state` and `delete_core_state`, which offer calls, reach the new guard through `user_state_of`, and it throws only on a transaction that `fail_transaction` marked, as `storage.md` sets (`fail_transaction` rule and the error table rows). Offer and its DEV code do not call `fail_transaction`, so `trigger_offer`, `is_offer_active`, `get_offer_ends_at`, `read_purchase_limit` and `set_offer` keep their behavior on an unmarked transaction. `logging.write` and `logging.track_core_event` did not change
- `ogw core test server offer` passed on this checkout (job mw8lkcgbb0ddcb, two runs reported `offer pass`; the job wrote no test record because the checkout had an uncommitted change, the deleted earlier review file `records/review/offer-1.md`)
- Code of offer outside the range (`server/core/offer/index.ts`, `server/core/offer/deps.ts`, `server/core/offer/dev/index.ts`) was read for the call paths above but not reviewed again as a whole target, since problems from before the range that the range does not cause or reveal are not findings. While reading it, no problem of severity `critical`, `high` or `medium` was seen
- The core tests of the modules that call offer (`shop`, `iap`) were not run: their call paths into offer did not change in the range
