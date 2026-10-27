# review admin-api round 1

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

- No file under server/core/admin-api/ changed in cf89b7fd..bb137f18. The changes that admin-api reaches are in `storage` and `routing`. `storage.sweep_expired` (server/core/storage/rows.ts:309) now deletes in batches and returns `{deleted, failed}`. admin-api does not call it. The only callers are routing job `storage_sweep` and tests of other modules. `table_def` (server/core/storage/schema.ts:191) now adds an index on the expiry column alone. This applies to the two admin-api tables with expiry column `expires_at` (`admin_api_ip_counter`, `admin_api_operation`, server/core/admin-api/tables.ts:18). admin-api does not read the index list of its tables. `NO_FREE_CONNECTION` (server/core/storage/db/pg_messages.ts:53) is now `POOL` and is in `LOCK_CODES`, as `55P03` already was. `routing.ipRateLimitPerMinute` is now 300, up from 60. No admin-api code reads a DB error code or that setting
- Checked against the `storage` `### expiry` rules for tables with an expiry column. `read_ip_failures` (server/core/admin-api/tables.ts:82) and `read_operation` (server/core/admin-api/tables.ts:102) count a row with `expires_at` <= now as absent. `add_ip_failure` (server/core/admin-api/tables.ts:89) and `write_operation` (server/core/admin-api/tables.ts:113) write with one upsert. With the new PostgreSQL batch delete (`ctid = ANY(...) AND expires_at <= $1`), a row that `write_operation` rewrote is not deleted
- The admin-api core tests (server/core/admin-api/tests, 12 files) ran on SQLite against this range's code: 98 passed, 1 skipped. They used a temporary copy with `server/build/data` from open-game-works-core-impl/. The PostgreSQL run was not done because no PostgreSQL server is on this host. So the PostgreSQL path of the new expiry index on `admin_api_ip_counter`/`admin_api_operation` and of the batch delete on those tables was checked only by reading the code
