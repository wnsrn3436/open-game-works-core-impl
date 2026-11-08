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

- The commit range 85f6b36d..08801f2a changes no file under `server/core/migration/`. I reviewed the changes that the code of migration calls or that call it: `storage` (`db/meter.ts`, the `counting_adapter` wrapping, the SQLite `set_wal` retry and `BEGIN IMMEDIATE` retry path, `tx.ts` `make_seed`, the seed provider now called before the ctx with request ID, user ID and request name), `logging` (`read_metrics`, metrics counted in `write`), `routing` (the `server_process.ts` front with request workers and a realtime worker that each make one server instance, `routing_module.ts` job `routing_ops_report`, the settings check at `create_server`, `spec_tables.ts`), `start.ts`, `testing/dev/test_server.ts`, and the settings schema keys `migration.*`. None of them changes a behavior that migration relies on. `run_user_transaction` passes `fields` null to `open_user`, so the new seed provider call does not run for batch user transactions. Several server instances in one server process each run job `migration_batch`, and the existing lease conditional updates and `INSERT ... ON CONFLICT DO NOTHING` of `migration_converter` already cover that, the same as for several processes
- `ogw core test server migration` passed in this checkout (job mw7whyekefb342). I did not check which DB targets that run used. I did not run the migration tests against PostgreSQL on their own
- Problems in migration code from before this range were not reviewed in full, because the range does not change migration. Only the paths above were read
