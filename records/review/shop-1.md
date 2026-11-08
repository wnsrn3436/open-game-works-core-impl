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

- The commit range 85f6b36d..b570275f changes no file of `server/core/shop/`, and no file of `server/core/mailbox/`, `server/core/live-event/`, `server/core/offer/`, `server/core/server-time/` or `server/core/idempotency/`. In `server/core/validation/` only tests change. No `shop` line of `server/generated/contract/core_contract.ts` changes. Input `## spec changes` is `none`
- Checked the changes of the range in the dependency modules on the call paths of `server/core/shop/index.ts`: `server/core/item-ledger/history.ts` and `server/core/item-ledger/ledger.ts` (the history counter `take_seq` with plain inserts, and the separate `item-ledger.onceKeyRetentionMs` for the `once_key` row expiry), `server/core/storage/index.ts`, `server/core/storage/core.ts` and `server/core/storage/tx.ts` (seed provider signature, `make_seed`, DB meter, `read_db_metrics`), `server/core/logging/index.ts` (metrics counted in `write`, `read_metrics`) and `server/core/routing/pipeline.ts` (`duration_ms` from the real clock, the minimum app version judgement, log reason wording). `subtract_items`, `preview_add_items`, `grant_or_mail`, `get_state`, `put_core_state`, `with_hook_change_source`, `check_hook_output` and `track_core_event`, which shop calls, keep their signatures and the behavior that shop relies on. One purchase that both subtracts the cost and grants the reward takes the history counter twice in one transaction, which `item-ledger` defines. shop and its tests use no changed storage member (`set_seed_provider`, `make_seed`, `watch_db_wait`, `read_db_metrics`)
- `ogw core test server shop` passed on this checkout (job mw7xcs3s005799, two runs reported `shop pass`)
- Code of shop outside the range (`server/core/shop/index.ts`, `server/core/shop/tests/`) was read for the call paths above but not reviewed again as a whole target, since problems from before the range that the range does not cause or reveal are not findings. No `critical`, `high` or `medium` problem was seen while reading it
