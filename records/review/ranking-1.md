# review: ranking round 1

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

- The commit range `cf89b7fd2768ede33b78f5948fb0fae06df506e2..cbcfcc27fb9ba961f33d30e63b9d537cb1a61138` changes no file under `server/core/ranking/`. The changes in that range that the ranking code reaches through its dependencies were checked against the ranking code: `storage` `table_def` adding an expiry column index (`server/core/storage/schema.ts`) does not apply, because all five ranking tables are registered with expiry `null` (`server/core/ranking/store.ts:14`). `CREATE INDEX IF NOT EXISTS` names an index by its columns, so the ranking indexes are created as before. The `sweep_expired` result type change (`server/core/storage/rows.ts`, `server/core/routing/routing_module.ts`) is not called by ranking code or tests. Moving the pool wait code from `55P03` to `POOL` (`server/core/storage/db/pg_messages.ts`, `server/core/storage/db/postgres.ts`) keeps it in the lock failure codes, and ranking does not read DB error codes. The `item-ledger` and `mailbox` changes are test-only. The `ads-reward`, `routing` `ENV_GAME_SETTINGS`, client and settings changes are outside what ranking reaches. So no ranking finding comes from this range
- The ranking core tests were not run. With no candidate finding there was nothing to check by a run, and a run needs the built core test data and PostgreSQL that `ogw core test` provides. `ogw review run` runs the core tests of the modules that depend on `storage` after each fix
- Ranking code that the range does not reach was not reviewed again, because the commit range is not `none`
