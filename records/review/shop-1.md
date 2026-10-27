# review shop round 1

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

- The commit range cf89b7fd..bb7a2504 changes no file under `server/core/shop/`. The changed server code reached from shop is limited to `server/core/storage/rows.ts` (`sweep_expired` batch delete, which shop does not call; it touches the `item-ledger` `once_key` history rows that `mailbox.grant_or_mail` writes for `shop:<request ID>` only after their expiry), `server/core/storage/schema.ts` (expiry index; shop defines no table) and `server/core/storage/db/postgres.ts` / `pg_messages.ts` (`NO_FREE_CONNECTION` as a lock code, handled in the `storage` and `routing` transaction path, not in shop). No change in shop behavior was found from these; their own correctness belongs to the `storage` and `routing` reviews and was not judged here.
- `ogw core test server shop` passed on this checkout (job mvqlumdfc44984). The PostgreSQL runs of the changed `storage` sweep tests were not run, as they are outside the shop target.
- The `shop_product` data rules (`max_quantity`, `limit_count`, `reset`, `offer`, empty `reward` with `extra_grant` `false`) are checked in `tools/data-tool/src/checks/shop.ts`, outside the shop module and unchanged in the range; not reviewed.
