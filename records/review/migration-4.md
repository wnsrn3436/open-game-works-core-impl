# review migration round 4

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

- The commit range `c9561aea..a059dbfe` changes no file of `server/core/migration/`. Its changes in the dependencies of migration are in `server/core/storage/` (`core.ts`, `tx.ts`, `rows.ts`, `state.ts`, `user_change.ts`, `db/postgres.ts`, `db/pg_worker.ts`, `db/pg_messages.ts`, `db/sqlite.ts`, `db/types.ts`, `index.ts`), `server/core/logging/log_line.ts` and `settings/core-settings.schema.json`. Other modules changed in the range (routing, data-tool, user-snapshot-clone tests and others) were not reviewed.
- The round 3 review had no `## findings` row and no `open` `## previous` row, so step 5 had no row to decide and `## previous` is `none`.
- Spec changes: the diff changes no line of `migration.md`. The changed `storage.md` rules were read against the migration code they reach. `lock_game_row` key types: migration passes a `string` key at both `lock_game_row` calls of `migration_batch` (`server/core/migration/index.ts:335` `[batch_id]`, `:417` `['']`). A body that returns after a statement aborted its transaction is now `FAILED` (`server/core/storage/tx.ts` `body`): the transactions of `insert_converter_rows` (`:313-320`), the lease write of `step` (`:352-361`) and `finish_step` (`:333-344`, `:385-388`) handle a `FAILED` result, the batch user transaction counts `FAILED` and a throw as a failed user (`:372-383`), and `start_migration_batch` returning `internal` on `lock_game_row` `FAILED` is turned into `internal` by `admin-api` either way (`server/core/admin-api/index.ts:438-443`). The `read_db` throw rule and the read retry on a new connection reach the `read_db` queries at `:348`, `:364`, `:369`, whose throws are caught by `run_job` (`:395-399`). The U+0000 rule does not reach migration: the strings it writes are kind column values of the contract, base64url IDs and the JSON of decimal user IDs. No difference from the defining documents was found. The `logging.md` changes (the `log` level fallback removed, client log and analytics counts, analytics deletion job) do not reach the `error` and `core` lines that migration writes with `logging.write` at the levels `error`, `warn`, `info`. The `core` `SKILL.md` and `command.md` changes set no migration behavior.
- Whether `storage` implements its changed PostgreSQL rules (advisory lock key, `statement_timeout` as `57014`, read retry, abort handling) is part of the `storage` target and was not checked.
- Test run: the migration tests were run with vitest of the harness tools (globals, forks), `OGW_DEFAULT_DB` `sqlite`, the server build data of `open-game-works-core-impl/server/build/data` (not data built from this checkout) and `fixtures/` of this checkout. 50 of 55 passed. The 5 failures are the PostgreSQL tests of `admin.test.ts` and `processes.test.ts`, which failed because this environment gives no `OGW_POSTGRESQL`. So the PostgreSQL runs were not checked.
