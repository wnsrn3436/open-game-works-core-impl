# review: user-snapshot-clone round 1

## findings

none

## previous

none

## out of scope

- server/core/item-ledger/history.ts:182: medium Commit 8ba7373a changes the `item_ledger_once_key` column from the raw `once_key` to its SHA-256 form (`has_once_key` and `put_once_key` now hash the value), and nothing converts rows written in the old form: no module of `server/core/` other than `item-ledger/history.ts` refers to `item_ledger_once_key`, and `migration` has no `once_key` conversion. Released v0.10.0 contains 625ae189 but not 8ba7373a, so it writes raw rows. Run path: a server on v0.10.0 writes a row with `once_key` `rating:<rule>:<season>` (server/core/rating/index.ts:259) or `play_session_refund:<play_session_id>` (server/core/play-session/index.ts:320); after the core upgrade the same change is sent again within `item-ledger.onceKeyRetentionMs`; `has_once_key` looks for `sha256(once_key)`, does not find the raw row, and the change is applied a second time instead of `ALREADY_APPLIED`. The same path reaches `import_user_snapshot`: a snapshot exported from a v0.10.0 server passes check 4 (its `core_version` is lower), its `item_ledger_once_key` records are saved as they are (server/core/user-snapshot-clone/index.ts:399), and the clone does not hold the `once_key` judgement of the source user. A one-time conversion at upgrade would not cover these rows, because they are imported later. So the item-ledger fix also needs a decision on the user-snapshot-clone side: convert the rows on import, or refuse snapshots made with the older row form

## debt

none

## must fix

none

## unknown

- The out-of-scope `once_key` path was traced in the code and was not run against a real v0.10.0 snapshot
- The range does not change any file under server/core/user-snapshot-clone/. I checked the dependency changes it calls into. `session.end_session` (server/core/session/index.ts:137) now deletes only the ctx session when ctx `session_id` is not empty. The import handler and the clone wipe call it in a ctx from `storage.run_user_transaction`, which opens with no request fields (server/core/storage/tx.ts:171, `Ctx.session_id` is `''` at server/core/storage/core.ts:97), so the whole session is still ended. This matches `session` line 49. `storage.fail_transaction` makes later storage operations throw a `DbError` that is not a `StorageMisuse`, and user-snapshot-clone never calls it. The import handlers map only `StorageMisuse` to `bad_request` and rethrow anything else, so this does not change their results. The item-ledger history personal-data column and `source` change touch only `item_ledger_history`, which is excluded from the snapshot
- `ogw core test server user-snapshot-clone` passed (job mw8lncife66107). It ran in a checkout with an uncommitted change, so no test record was kept. The whole suite was not run
