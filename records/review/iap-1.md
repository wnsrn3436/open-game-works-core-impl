# review iap round 1

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

- The commit range cf89b7f..376c63c changes no file in `server/core/iap/`. The changes that reach iap are the storage expiry sweep (`server/core/storage/rows.ts` `sweep_expired`: batch deletes by row address with the outer expiry condition, per-table time budget, failed table list), the expiry column index that `register_table` adds (`server/core/storage/schema.ts` `with_expiry_index`), the PostgreSQL free-connection wait code `POOL` in the lock codes (`server/core/storage/db/pg_messages.ts`, `server/core/storage/db/postgres.ts`) and the `storage_sweep` error log per failed table (`server/core/routing/routing_module.ts`). Checked against iap: all five iap tables use `delete_at` as expiry column with no index starting with it, so each gets a `delete_at` index as the `storage` spec requires; the iap upserts (`server/core/iap/tables.ts:185-214`) overwrite `delete_at` on a key whose expired row is not yet deleted, and the outer expiry condition of the batch delete keeps such a rewritten row; iap reads through `$LIVE` (`server/core/iap/tables.ts:67`), so an expired row left by a budget-limited or failed sweep counts as absent; iap does not call `sweep_expired` or inspect DB error codes. No finding came from these
- The iap core tests were run only with `OGW_DEFAULT_DB` `sqlite` (9 files, 123 tests, all passed), with `OGW_SERVER_DATA` from `open-game-works-core-impl/server/build/data`. The PostgreSQL run was not done because no PostgreSQL test database was available to this agent, so the PostgreSQL form of the batch delete (`ctid = ANY(ARRAY(...))`) was checked only by reading against concurrent iap upserts, not by a run
- Code of iap outside what the range changes reaches (adapters, grant order, notification handling, ownership transfer, daily reward) was not reviewed, since the commit range is not `none`
