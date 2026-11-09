# review remote-config round 1

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

- The commit range 625ae189..4d1e592e changes no file under `server/core/remote-config/`, does not change the remote-config spec (`## spec changes` is `none`), and changes no `remote-config.*` key in settings: the only settings schema change (`settings/core-settings.schema.json`, `server/generated/core_settings_schema.json`) is the minimum of `admin-api.maxSearchRows`. No generated contract file changes in the range, so `RemoteConfigValue`, `RemoteConfigEntry`, `ExperimentAssignment` and `GetRemoteConfigResponse` are unchanged
- The changes the range makes in the modules remote-config calls were read where remote-config reaches them: `storage` adds `fail_transaction` (`server/core/storage/tx.ts:373`), the `failed` mark of `TxState` (`server/core/storage/core.ts:131`), the `not_failed` check in `user_state_of` and `any_state_of` (`server/core/storage/core.ts:268`), and the `FAILED` result of a marked transaction in `body` (`server/core/storage/tx.ts:225`). Remote-config does not call `fail_transaction`, and its only caller outside storage is `item-ledger` (`server/core/item-ledger/ledger.ts:448`), which no remote-config admin operation calls in its game transaction. So `storage.db(tx)`, `storage.lock_game_row(tx, ...)` and `storage.after_commit(tx, ...)` in `server/core/remote-config/index.ts` run on transactions that are never marked and behave as before. `get_config` and `get_client_config` read only the in-memory view (`view_of`, `server/core/remote-config/index.ts:327`) and run no storage operation, so a request transaction that item-ledger marked does not change what they return. `logging` changes only a comment of `Metrics.alerts` (`server/core/logging/metrics.ts:208`); `write`, which remote-config calls, is unchanged. `server-time` has no change in the range
- `ogw core test server remote-config` in this worktree at 4d1e592e gave `remote-config pass`
- The remote-config code outside what the range reaches was not reviewed, because a review with a commit range reviews only problems that the range causes or reveals. In particular, whether the request cache view (`view_of`, `server/core/remote-config/index.ts:327`, taken at the first remote-config read of a ctx rather than at transaction open as `## behavior` says) can be observed to differ was not checked
