# review user-snapshot-clone round 5

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

- Nothing under server/core/user-snapshot-clone changed in the commit range, and neither did the user-snapshot-clone spec. The range changed the dependency `storage` (server/core/storage/tx.ts `body`, core.ts `mark_broken`/`broken_by`, `lock_row`, `run_savepoint`, db/sqlite.ts U+0000 parameter failure, db/postgres.ts `57014`, rows.ts and state.ts `get_user_records`/`get_states`) and the caller `admin-api` (index.ts `run_transaction` `lock_failed`, `read_switch_cache`, definition.ts `is_user_target`/`binary_errors`, body.ts `check_query`). The spec diff changes core/SKILL.md, core/command.md, logging.md and storage.md. I checked these changes against every call that this module makes
- Statement failures under the new `storage` `### transaction` rule: every handler and transaction function of this module either rethrows a non-`StorageMisuse` throw unchanged (server/core/user-snapshot-clone/index.ts:398-404, :543-548), or does not catch it (index.ts:281-298, :409-411, :432). So a statement failure rolls back and throws, and `admin-api` `handle` (server/core/admin-api/index.ts:480-485) answers 500 `internal` with an `error` log and the `audit` line. A `lock_game_row` `FAILED` inside a transaction (index.ts:282, :293, :407) still ends as `FAILED`/`internal`: tx.ts `body` now returns `FAILED` for a broken transaction whatever the function returns
- U+0000: a snapshot whose `source_environment` holds U+0000 passes checks 1 to 5 (snapshot.ts:117-160) and fails at the `WRITE_CLONE` query (index.ts:409-411), which is a save failure during import (user-snapshot-clone.md `## error`). I checked this on a temporary copy outside the checkout with a probe test on SQLite: the reply was 500 and `dumpDb` did not change. Record `table` and `key` strings reach statements only through `storage.replace_user_rows` / `replace_game_rows`, which check the raw row format
- The `read_db` failure rule: the only `read_db` query is in the sweep (index.ts:311-319), and its throw is caught and logged with `error`
- `lock_game_row` key types: the module passes a `bigint` `target_user_id` at every `lock_game_row` of `user_snapshot_clone_record` (index.ts:282, :293, :407), as storage.md now requires
- The admin-api changes: `import_user_snapshot` and `export_user_snapshot` have a required `int64` `user_target`. The binary body operations have byte limits and an `int64` query field. No operation of this module has an `operation_id` input
- Tests run: the whole user-snapshot-clone suite (5 files, 83 tests) on a temporary copy of HEAD outside the checkout, with vitest on SQLite (`OGW_DEFAULT_DB=sqlite`) and `server/build/data` copied from open-game-works-core-impl/. All passed. PostgreSQL is not installed on this host, so the PostgreSQL paths were checked only by reading the code: the abort and lock failures, the `57014` handling, and the `hold_game_row_lock` test at server/core/user-snapshot-clone/tests/game-state.test.ts:258 as it runs on PostgreSQL
