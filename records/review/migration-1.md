# review: migration round 1

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

- The commit range cf89b7fd..031723c changes no file under `server/core/migration/`. The checked changes that migration reaches are those of `storage` it calls: `register_table` (`server/core/storage/schema.ts:186` adds the expiry column index only for a table with an expiry column; `migration_converter` and `migration_batch` are registered with expiry `null` at `server/core/migration/index.ts:441` and `server/core/migration/index.ts:453`, and `CREATE INDEX IF NOT EXISTS` does not change their tables), `sweep_expired` (`server/core/storage/rows.ts:385`; migration does not call it and its tables have no expiry column), and the PostgreSQL error code of a wait for a free connection (`server/core/storage/db/pg_messages.ts:53`, `server/core/storage/db/postgres.ts:19`; it stays a `lock` DbError, so `run_game_transaction`, `run_user_transaction` and `lock_game_row` failures that migration handles at `server/core/migration/index.ts:329`, `server/core/migration/index.ts:352`, `server/core/migration/index.ts:367` and `server/core/migration/index.ts:411` have the same result as before). `ogw core test server migration` passed on this checkout
- Code of migration not reached by the changes of the range (converter registration, `convert_item`, the batch step, `migrate_snapshot`) was not reviewed again, because the range does not change it
