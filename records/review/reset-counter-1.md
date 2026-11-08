# review reset-counter round 1

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

- The commit range 85f6b36d..1456e784 changes no file under `server/core/reset-counter/`, `server/core/server-time/`, `core-spec/reset-counter.json` or `test-data/data/tables/reset_counter.csv`. The changes to `storage` that reset-counter calls (`server/core/storage/index.ts`, `server/core/storage/tx.ts`, `server/core/storage/core.ts`, `server/core/storage/dev/index.ts`: DB meter, `make_seed`, `watch_db_wait`, `read_db_metrics`, seed provider called with request ID, user ID and request name before the ctx is made) do not change `get_state` or `put_core_state`, the only `storage` operations reset-counter uses (`server/core/reset-counter/index.ts:11`), so they cause no reset-counter finding
- `ogw core test server reset-counter` passed on this checkout. The tests were not run on PostgreSQL apart from what that run's default DB kind covers
- The data check `out_of_range` for a row `limit` of 0 is tested in `tools/data-tool/tests/reset-counter-checks.test.ts`, outside this target. Its code was not reviewed
- Client `UserStateCore.get_reset_counter`, which reads the count by the same rules, is a client module outside this target and was not read
