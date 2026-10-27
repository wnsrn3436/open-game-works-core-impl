# review: public-profile round 1

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

- The range cf89b7fd..e55ded5 changes no file under server/core/public-profile/ (`git diff --stat` lists none; the last public-profile commit fb08f83 is an ancestor of cf89b7fd). The changes read for their effect on public-profile are those of `storage` (server/core/storage/rows.ts `sweep_expired` batch delete, server/core/storage/schema.ts expiry column index and `CREATE INDEX IF NOT EXISTS`, server/core/storage/db/pg_messages.ts and db/postgres.ts `NO_FREE_CONNECTION` `POOL` in `LOCK_CODES`) and of `routing` (server/core/routing/routing_module.ts job `storage_sweep`). Checked: `public_profile_find_counter` (registered with expiry column `expires_at` and no index, server/core/public-profile/index.ts:171) now gets the one-column `expires_at` index, also for a table already in `storage_schema` (schema.ts:310-311); `count_find_attempt` writes the counter with one upsert and reads `count` from its `RETURNING` (index.ts:99-101, 267), which keeps the `storage` `### expiry` rules for a row that the batch sweep deletes during the transaction; a free-connection wait that runs out is still a lock failure (`FAILED` of `run_user_transaction`), as it was with code `55P03`. Other changes of `storage`, `routing`, `ads-reward` and the other modules in the range were not reviewed
- The public-profile tests were run on SQLite only (vitest of the harness, `OGW_DEFAULT_DB=sqlite`, server data of the main core checkout): 3 files, 35 tests passed. The PostgreSQL run was not made (no PostgreSQL database was set up), so the batch sweep SQL with `ctid` on `public_profile_find_counter` and the `COUNT_FIND` upsert were not run on PostgreSQL
