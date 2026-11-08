# review block-report round 1

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

- The commit range 85f6b36d..910daf01 changes no file under `server/core/block-report/`. The block-report code and tests were read in full, and the changes of the range that block-report reaches were checked against them: `storage` (`server/core/storage/index.ts`, `core.ts`, `tx.ts`, `db/meter.ts`, `db/sqlite.ts`, `db/postgres.ts`: the DB meter wrapping of statements, `lock_game_row` and transaction starts, `make_seed`, the seed provider signature), `logging` (`server/core/logging/index.ts`: metrics counting of the log lines that `write` writes, including the `error` and `warn` lines of `add_report`), the routing request workers and settings check (`server/core/routing/routing_module.ts`, `start_parts.ts`, `server/core/start.ts`), and the `block-report.*` entries of `settings/core-settings.schema.json` and `settings/core-settings.json` (values and minimums unchanged, matching `## settings` of the spec). No change in the range alters a result of block-report: block-report keeps no in-memory state across requests other than its listener list and start flag, which are per server instance, so the request workers each make their own block-report.
- `server/core/validation/` changed only in its tests in the range; `server/core/public-profile/` and `server/core/server-time/` did not change.
- `ogw core test server block-report` was run twice on 910daf01 in this worktree. The first run failed 4 PostgreSQL tests (`block.test.ts` withdrawn-user block row deletion: INTERNAL; `block.test.ts` listener order: `admin-api` maintenance state read `canceling statement due to statement timeout`; `withdraw.test.ts` add_report of a withdrawn target: RunCoreTest error code 8 (INTERNAL); `withdraw.test.ts` two-instance lock test: `the peer process did not start: wait_background did not end within 10000 ms`). The host had about 60 other jobs running then. The second run, right after, passed every block-report test on SQLite and PostgreSQL. The failures were statement and start timeouts and were not reproduced, so their cause (host load or a timing dependence of these tests) was not checked and is not written as a finding.
- The `testing` and `admin-api` changes of the range were not reviewed beyond how block-report tests use them (`start_test_server`, `send_admin`, `start_peer_process`); they are outside this target.
