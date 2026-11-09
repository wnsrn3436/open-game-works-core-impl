# review notice round 1

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

- The commit range 625ae189..6789f23f changes no file of `server/core/notice/`. The checked changes that notice reaches are those of its dependencies: `server/core/storage/core.ts`, `server/core/storage/tx.ts`, `server/core/storage/index.ts` (`fail_transaction`, and the `failed` check in `user_state_of` and `any_state_of`), `server/core/admin-api/operations.ts` (`list_history` output only), `server/core/logging/metrics.ts` (comment only) and `settings/core-settings.schema.json` (`admin-api.maxSearchRows` minimum). Notice does not call `fail_transaction` (`server/core/notice/index.ts:23` picks `register_table`, `db`, `read_db`, `lock_game_row`, `after_commit`), and no admin-api path that runs notice operations calls it, so the new `failed` checks never fire on a notice transaction. No finding comes from these changes
- `ogw core test server notice` ran on this checkout and passed (job mw8n1qyr49b257); the tool wrote no test record because the checkout had an uncommitted change (the deleted earlier `records/review/notice-1.md`). Whether those tests ran against PostgreSQL as well as SQLite was not checked
- The client module `NoticeCore` (`client/godot/core/notice_core/notice_core.gd`, changed in this range) is not this target and was not reviewed
- The core tests of other modules (storage, admin-api, item-ledger) were not run: their changes are reviewed with those targets
