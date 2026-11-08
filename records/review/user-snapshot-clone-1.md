# review: user-snapshot-clone round 1

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

- The commit range does not change `server/core/user-snapshot-clone/`. The changes of the range that the target calls or is called by were read for effects on it: `storage` (DB meter around adapter calls, `make_seed`, seed provider signature, `watch_db_wait`, `read_db_metrics`, SQLite WAL retry at open), `logging` (metrics on each written line, `read_metrics`), `routing` (server process with request workers, settings check at `create_server`, `duration_ms` from the real clock, min-version step 7), `testing/dev/test_server.ts` and `storage/tests/helpers.ts`. None changes an operation the target calls (`read_user_rows`, `replace_user_rows`, `set_user_created_at`, `get_user_record`, `sample_users`, `read_game_rows`, `sample_game_rows`, `replace_game_rows`, `lock_game_row`, `run_user_transaction`, `run_game_transaction`, `db`, `read_db`, `register_table`, `logging.write`, `server-time.schedule_job`/`clock_now`, `session.end_session`, `validation.parse_version`/`compare_versions`)
- With `routing.requestWorkers` (core default 2) every request worker instance now registers its own job `user_snapshot_clone_sweep` and may run `wipe_clone` and `import_user_snapshot` for the same target at the same time. This was checked by reading `clone_wipe` in `server/core/user-snapshot-clone/index.ts:279`: each wipe locks `user_snapshot_clone_record` of the target with `lock_game_row` inside the user transaction (and inside the game transaction on `WITHDRAWN`) and reads the clone record again, so a second worker's wipe sees no record and writes no `audit` line. No test runs two request workers against this module; the existing concurrency tests run in one server instance
- `ogw core test server user-snapshot-clone` passed on this checkout with the default core test DB kind. A run against the other DB kind (PostgreSQL or SQLite, whichever is not the default) was not made
- The settings schema properties of `user-snapshot-clone.*` (`settings/core-settings.schema.json:695`) were compared with `## settings` of the spec; the settings check at `create_server` added in the range now rejects bad values before the module's own `integer_setting` check, which is unchanged
