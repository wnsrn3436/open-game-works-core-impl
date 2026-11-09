# review testing round 1

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

- The commit range 625ae189..8bab3de9 changes no file under `server/core/testing/`. Only the changed code that testing calls or passes through was read: `storage` (`fail_transaction`, `TxState.failed`, `not_failed` in `user_state_of`/`any_state_of`, `body` in tx.ts), `session.end_session`, `logging` metrics `alerts`, `item-ledger` (`set_balance` path through `call_dev`, hook failure, `once_key` hash, history `source` value), the `iap` fake adapter (`lookup_subscription` result `GONE`, which the `fake` controller of server/core/testing/dev/test_server.ts:668 hands through unchanged) and the settings schema minimum of `admin-api.maxSearchRows` (server/core/testing/dev/setting_types.ts:182 keeps type `integer`, so the override type check is unchanged). Their own behavior is reviewed under their own targets
- `read_user_state` and `read_server_state` (server/core/testing/dev/index.ts:123-129) read the `user_state` and `server_state` tables only, so the `once_key` and history table changes of item-ledger do not reach them; this was checked by reading the code, not by a test
- `ogw core test server testing` was run on the checkout (SQLite and PostgreSQL runs): both `pass`. The tests of the modules that depend on testing were not run here, because `ogw review run` runs them
- No defect was restored in a temporary copy, as there is no finding and no previous round
