# review: shop round 1

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

- The commit range 625ae189..8a5ff21c changes no file of `server/core/shop/`, and no file of `server/core/mailbox/`, `server/core/live-event/`, `server/core/offer/`, `server/core/validation/`, `server/core/server-time/` or `server/core/routing/`. No line of `server/generated/` that shop uses changes (only `server/generated/core_settings_schema.json`, with no `shop` key). Input `## spec changes` is `none`
- Checked the changes of the range in the dependency modules on the call paths of `server/core/shop/index.ts`: `server/core/item-ledger/ledger.ts` (core source misuse and hook write misuse throw without a log; a hook failure calls `storage.fail_transaction` and throws), `server/core/item-ledger/history.ts` (the `once_key` table keeps the SHA-256 form; `list_history` gives `source` as the enum value; history is personal data), `server/core/storage/core.ts`, `server/core/storage/index.ts`, `server/core/storage/tx.ts` (`fail_transaction`) and `server/core/logging/metrics.ts` (comment only). shop catches no throw of `subtract_items`, `preview_add_items` or `grant_or_mail`, so a hook failure of item-ledger inside a purchase ends the request as `INTERNAL` with nothing saved, which matches the `INTERNAL` rows of the shop `## error` table. shop always passes source `Shop`, so the core source misuse path is not reached. The `once_key` `shop:<request ID>` is built from a request ID that `server/core/routing/http.ts:44` accepts only as a UUID v4, so the new unpaired surrogate refusal of `resolve` is not reached from shop. The `once_key` hash changes only the `once_key` table; the history row still keeps `shop:<request ID>`, which `server/core/shop/tests/buy.test.ts:46` checks through `admin-api` `list_item_history`, and `server/core/admin-api/operations.ts:221` turns the new enum `source` back into its element name there
- `ogw core test server shop` passed on this checkout (job mw8oc4o9a90dfa, two runs reported `shop pass`; no test record was written because the checkout had the uncommitted deletion of the previous `records/review/shop-1.md`)
- Code of shop outside the range was read for the call paths above but not reviewed again as a whole target, since problems from before the range that the range does not cause or reveal are not findings. No `critical`, `high` or `medium` problem was seen while reading it
