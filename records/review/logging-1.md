# review: logging round 1

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

- Commit range 51d323b..14f1936 changes the logging target only in commit 65689cb: `server/core/logging/log_line.ts` (`truncate_ip`), `settings/core-settings.schema.json` (logging minimums) and the logging tests. Checked against `logging.md` `## API`, `### server log`, `### client log collection`, `### analytics adapter`, `### analytics deletion`, `## settings` and `## test`, and server-core `## log` (truncated IP)
- `truncate_ip`: checked the `::ffff:0:0/96` test (words 0 to 4 are 0, word 5 is `0xffff`) for the dotted, hex, uppercase, expanded and zero-padded forms, the zone id split, and whether the result stays the same when truncated again. Callers `auth/context.ts:110`, `auth/deletion.ts` and `admin-api/index.ts:159` only put the result into log fields, so the change does not alter any comparison or limit key
- Schema minimums: `logging.maxEventParams` 5 and `logging.maxStringLength` 23 cover the core analytics event table (longest name `core_attendance_claimed`; longest string values `LOGIN_PROVIDER_GOOGLE` and `IAP_STORE_GOOGLE` from `proto/ogw/core.proto`). The defaults in `settings/core-settings.json` meet every new minimum. Whether the harness settings check applies the schema to game settings overrides was not checked; that is harness code, outside this target
- Storage changes in range that logging relies on (`tx.ts` `body` returning `FAILED` on a broken transaction, `mark_broken`, `run_savepoint`) were read against the logging calls `run_game_transaction` in `count_deletion_failure` and `send_deletions`, `after_commit` and `count_report_request`. No changed behavior reaches a logging result
- Tests were run only on SQLite (`OGW_DEFAULT_DB=sqlite`), using vitest from the harness tools and the server build data folder and fixtures of the `open-game-works-core-impl/` main checkout (at ebc957c, not a build from this worktree): 10 files, 93 tests, all passed. The PostgreSQL run was not done
- The new tests were read for whether their assertions check the result. Restoring the old `truncate_ip` makes the `::ffff:cb00:714d` cases fail by reading the code; this was not run on a temporary copy, which round 1 does not require
- The real GA4 endpoints were not called; `analytics-ga4` was checked only through the recorded-fetch tests and by reading `adapters/analytics_ga4.ts`
