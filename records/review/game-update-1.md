# review game-update round 1

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

- Checked: `git log 625ae189..15b40fbe -- server/core/game-update` lists no commit, so the range changes no game-update code or test. Read the changes of the range in the modules that game-update calls (`storage`, `logging`; `validation` and `server-time` are unchanged): storage `fail_transaction` (server/core/storage/core.ts `not_failed` in `user_state_of` / `any_state_of`, server/core/storage/tx.ts `body` and `fail_transaction`) only changes a transaction that `fail_transaction` marked, and game-update never calls it (server/core/game-update/admin.ts:97-186, index.ts:93-193 call only `run_game_transaction`, `db`, `read_db`, `lock_game_row`, `after_commit`, `register_table`); the only production caller is server/core/item-ledger/ledger.ts:448, which game-update does not depend on (game-update.md `## dependency`). The logging change (server/core/logging/metrics.ts `alerts` comment and tests) does not change `logging.write`, which game-update calls. The admin-api change (server/core/admin-api/operations.ts `list_item_history` source names) does not touch the admin transaction that runs the game-update handler functions
- Checked: the matchmaker `HELLO` minimum app version path that an earlier review wrote as out of scope now calls `game_update.is_below_min_version` and `validation.is_platform` (server/core/matchmaker/realtime.ts:424-429)
- `ogw core test server game-update` passed (no test record: the checkout has uncommitted changes, the deleted earlier review file)
- Not checked: the other changes of the range (iap, item-ledger, session, auth, idempotency, nickname, routing records), as game-update neither calls them nor is called by them
