# review cheat round 1

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

- The range `cf89b7fd2768ede33b78f5948fb0fae06df506e2..bb137f183f87b07d5f89599d588b29b4ce24c4a6` changes no file of `server/core/cheat/`, and no file of the cheat spec. The changes that reach code cheat calls or code that calls cheat were read: `storage` `sweep_expired` batching and its new result type (`server/core/storage/rows.ts`, `server/core/storage/index.ts`, `server/core/routing/module_api.ts`, `server/core/routing/routing_module.ts`), the expiry index added in `table_def` (`server/core/storage/schema.ts`), `CREATE INDEX IF NOT EXISTS`, the PostgreSQL `NO_FREE_CONNECTION` code (`server/core/storage/db/pg_messages.ts`, `server/core/storage/db/postgres.ts`), the new settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`, and `routing.ipRateLimitPerMinute` 60 → 300. cheat registers `cheat_time_offset` with expiry `null` (`server/core/cheat/dev/offset_table.ts:9`), so the expiry index and the sweep do not touch it; cheat does not call `sweep_expired`; the cheat tests set only `routing.userRateLimitPerMinute` (`server/core/cheat/tests/processing.test.ts:47`) and do not depend on the IP rate limit default. The change of `client/godot/core/qa_core/dev/qa_core.gd` (release inputs in telemetry) does not touch the cheat requests QACore sends
- `ogw core test server cheat` passed at HEAD (SQLite default DB of that run). The PostgreSQL runs of the cheat tests were not run separately
- The whole cheat module was not reviewed again; only the changes of the range and the places they reach were checked, as the procedure sets for a commit range
