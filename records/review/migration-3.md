# review migration round 3

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

- The commit range `494ad032..c9561aea` changes no file of `server/core/migration/` and none of `server/core/storage/`, `server/core/server-time/`, `server/core/logging/`. Its server changes are in ads-reward, auth tests, block-report, coupon, gacha, guild, mission, nickname, public-profile and `settings/core-settings.schema.json` (only `auth.socialVerifyTimeoutMs` minimum), which migration does not call. Those modules were not reviewed.
- The round 2 review had no `## findings` row and no `open` `## previous` row, so step 5 had no row to decide and `## previous` is `none`.
- Spec changes: the only change to `migration.md` is the meaning text of `storage.userLockWaitMs` (now a reference to `storage` `## settings`), which changes no migration behavior. Of the changed `storage.md` rules, the migration code that they reach was read against them: `server/core/migration/index.ts` `step` (:347-389: `read_db` queries at :348, :364, :369, which throw under the new `read_db` rule and are caught by `run_job` at :395-399; the throw of `run_user_transaction` caught at :372-376), `finish_step` (:333-344) and `insert_converter_rows` (:310-325), which handle a `FAILED` result of `run_game_transaction`, and `start_migration_batch` (:416-423), which gives `internal` on `lock_game_row` `FAILED`. No difference from the defining documents was found. The `logging.md` and server-core `SKILL.md` log changes (the `request` field of the `routing` route line, truncated IP of `::ffff:0:0/96`, client log counts, analytics send) do not reach the `error` and `core` lines that migration writes with `logging.write`.
- Whether `storage` implements the changed PostgreSQL rules (advisory lock of `lock_game_row`, abort handling, `read_db` throw) is part of the `storage` target and was not checked. The PostgreSQL test `admin.test.ts` `start_migration_batch whose migration_batch key "" lock ...` holds the lock through `testing.hold_game_row_lock`, so it follows the lock that `storage` takes.
- Test run: the migration tests were run with vitest of the harness tools (globals, forks), `OGW_DEFAULT_DB` `sqlite`, the server build data of `open-game-works-core-impl/server/build/data` (not data built from this checkout) and `fixtures/` of this checkout. 50 of 55 passed. The 5 failures are the PostgreSQL tests of `admin.test.ts` and `processes.test.ts`, which failed because this environment gives no `OGW_POSTGRESQL`. So the PostgreSQL runs were not checked.
