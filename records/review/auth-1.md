# review auth round 1

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

- No file of `server/core/auth/` changed in `cf89b7fd..bb137f18`. Checked the changes of the range that auth's code reaches:
  - `server/core/storage/rows.ts:385` batched `sweep_expired` with a per-table budget: auth's expiry tables `auth_deletion_code` and `auth_deletion_ip_counter` (`server/core/auth/tables.ts:78`, `server/core/auth/tables.ts:87`) may now keep expired rows across runs. Auth treats an expired deletion code as none (`server/core/auth/deletion.ts:240`), writes both tables with one upsert statement (`server/core/auth/tables.ts:290`, `server/core/auth/tables.ts:314`), and reads the IP counter only for the current minute window (`server/core/auth/deletion.ts:286`), as `storage` `### expiry` requires. The outer expiry condition of `sweep_sql` (`server/core/storage/rows.ts:372`) keeps a deletion code row that `IssueDeletionCode` upserted after the inner select
  - `server/core/storage/schema.ts:191` adds the index `(expires_at)` to `auth_deletion_code` and `auth_deletion_ip_counter`, whose index lists are empty. `storage` `## API` (index list) defines this addition, so it is not a difference from `auth` `### table`
  - `server/core/storage/db/pg_messages.ts:53` changed the code of a free connection wait to `POOL` and `server/core/storage/db/postgres.ts:19` keeps it a lock failure. auth reads no DB error code (no use of `55P03`, `DbError` or `is_db_failure` in `server/core/auth/`)
  - `settings/core-settings.json:95` raised the `routing.ipRateLimitPerMinute` default to 300. auth's own limit `auth.deletionAttemptsPerMinute` and its counter are unchanged
- Ran the auth core tests (`server/core/auth/tests`, 14 files, 138 tests) on the code at `bb137f18` with `OGW_DEFAULT_DB` `sqlite` and with `postgresql` (a temporary PostgreSQL 18.6 container), using the server build data of `open-game-works-core-impl/server/build/data`: all passed in both runs. The core tests of other modules were not run
- `client/godot/plugins/ogw-secure-storage/` (macOS keychain plugin of client `AuthCore`) and `client/godot/core/auth_core/tests/test_secure_storage_plugin.gd` changed in the range. They belong to client `AuthCore`, not to the server module `auth` under review, and were only read briefly, not reviewed against the `AuthCore` spec
