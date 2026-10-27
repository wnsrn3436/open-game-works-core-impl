# review user-snapshot-clone round 1

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

- No file of `server/core/user-snapshot-clone/` changed in the range. I read the changes of the range that reach code this module calls: `storage` (`server/core/storage/rows.ts`, `server/core/storage/schema.ts`, `server/core/storage/db/postgres.ts`, `server/core/storage/db/pg_messages.ts`, `server/core/storage/index.ts`, `server/core/storage/core.ts`), `routing` (`server/core/routing/module_api.ts`, `server/core/routing/routing_module.ts`) and `server/core/testing/dev/setting_types.ts`.
- `storage.sweep_expired` now deletes in batches and returns `{ deleted, failed }`. The module does not call it, and its clone record table `user_snapshot_clone_record` is registered with expiry `null` (`server/core/user-snapshot-clone/index.ts:574-588`), so the sweep of `storage` does not touch it. The module's own job `user_snapshot_clone_sweep` (`server/core/user-snapshot-clone/index.ts:309-330`) is unchanged.
- `table_def` now adds an index of the expiry column alone, and `create_index_sql` now uses `IF NOT EXISTS`. The clone record table has no expiry column, so its index list stays `[['expires_at']]` as `### clone wipe` defines, and the same index name is created.
- The free-connection wait code is now `POOL` and is in the lock codes of the PostgreSQL adapter. The module treats every `run_user_transaction` result other than `COMMITTED` and `WITHDRAWN`, and every `run_game_transaction` `FAILED`, as a failed clone wipe (`server/core/user-snapshot-clone/index.ts:290-303`), which the next sweep period does again or which `wipe_clone` turns into 500 `internal`, so a change of which code counts as a lock failure does not change its result.
- The range adds no `register_table` call with snapshot flag `true` and does not change `read_user_rows`, `replace_user_rows`, `read_game_rows`, `replace_game_rows`, `lock_game_row` or `get_user_record`, so the included rows and the import and export paths are unchanged.
- Code outside the range was read only where the changes reach it. The commit range is not `none`, so the whole module was not reviewed again.
- Tests were not run. `node --test` cannot run them (they use a global `describe`), and `ogw core test` was not called because a review writes no files outside `output`. This review does not record whether the module tests pass after the range.
