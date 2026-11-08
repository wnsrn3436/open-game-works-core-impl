# chat review round 1

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

- The commit range 85f6b36d..910daf01 changes no file under `server/core/chat/` and none of `server-time`, `nickname`, `public-profile`, `block-report`, `friend` (only `server/core/guild/tests/query.test.ts` of `guild`). Input `## spec changes` is `none`. The review checked the changed code of the range that chat calls or runs under:
  - `storage` (`server/core/storage/db/meter.ts`, `server/core/storage/db/sqlite.ts`, `server/core/storage/db/postgres.ts`, `server/core/storage/index.ts`, `server/core/storage/tx.ts`): chat uses `register_table`, `get_state`, `db`, `lock_game_row` and `check_hook_output` (`server/core/chat/deps.ts:11`). `counting_adapter` and `CountedTx` (`server/core/storage/db/meter.ts`) only count a failure and rethrow the same error, so the `FAILED` of `lock_game_row` that `lock_channel` (`server/core/chat/index.ts:185`) relies on is unchanged; the SQLite `Connection.call` keeps the `db_error` conversion. The new seed provider and `make_seed` are not called by chat
  - `logging` (`server/core/logging/index.ts`, `server/core/logging/metrics.ts`): `write` now also feeds the metrics after the line is written. Chat writes only `core` `info` and `error` lines (`server/core/chat/index.ts:111`), whose request part of the metrics is null; nothing chat observes changes
  - `validation`: only tests changed; `check_text` that chat calls is unchanged
  - `routing` (`server/core/routing/pipeline.ts`, `server/core/routing/server_process.ts`, `server/core/routing/worker_main.ts`, `server/core/start.ts`): the server process now runs several worker instances on one DB. Chat holds no state between requests other than `hook_slots`, which each worker instance's `create_server` fills; the channel `seq` comes from one upsert of the locked channel row (`server/core/chat/tables.ts:197`) and the send interval from the `SENDER` table read in the user transaction, so the counts stay right across worker instances. The new step 7 `min_version` judgement and the `ServerError.detail` wording are routing behavior outside chat
- Chat code and tests that the range does not reach were not reviewed again, as the commit range is not `none`
- `ogw core test server chat` on 910daf01: the first run (job mw7vz1xo4f1c01) failed with PostgreSQL connect time limits, `DevLogin` `INTERNAL` and `rate counter transaction failed` while the host load average was about 42; the run right after it (job mw7w9ngsa12a8c), under the same load, passed on SQLite and PostgreSQL. The cause of the first failures (connect time limit under host load) was not checked further: it is in the `storage` PostgreSQL connect and the test host, outside this target
