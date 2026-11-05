# review push round 4

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

- The round 3 review file has no findings, so `## previous` has no rows
- In the commit range, the only push file that changed is `server/core/push/tests/helpers.ts:422`. `fail_statements` now throws `fail_transaction(handle, DbError lock)`, which marks the transaction broken the way a real failed statement does (`DbHandle.query` at server/core/storage/core.ts:194-208). Because `body` at server/core/storage/tx.ts:202 now returns `FAILED` only for a broken transaction, this change keeps the push failure tests on the `FAILED` path that `write_under_lease` (server/core/push/send.ts:329-339) retries
- storage `body` change (server/core/storage/tx.ts:196-206): every push game transaction function (server/core/push/send.ts:343, :369, :409, :463, :522, :547, :581, :590) runs its statements only through `core.storage.db(tx)`. That is a `DbHandle` whose owner is the transaction, so a lock or connection `DbError` marks it broken, and it still ends as `FAILED`. No push transaction function calls `read_db` (`read_db` is used only outside transactions: server/core/push/send.ts:426, :497, :567, :577, :607). `lock_target` (server/core/push/schedule.ts:66) throws a plain Error after `lock_row` marked the transaction broken (server/core/storage/tx.ts:393-406), so it ends as `FAILED` the same as before
- `check_text_param` (server/core/storage/db/types.ts:99-103), which now also fails an unpaired surrogate: client `device_token` comes from protobuf UTF-8 decoding, which cannot give an unpaired surrogate. `args` is stored as JSON text, and `JSON.stringify` escapes unpaired surrogates. A content-supplied `dedupe_key` with an unpaired surrogate throws, and the request is `INTERNAL`. This is the same as the U+0000 case of round 3. push.md lists no such check, so it is not a finding
- `scan_users` / `users_below`, core schema version 3, routing, admin-api, mailbox, matchmaker and PaymentCore changes in the range are not used by push
- No test was run. `node --test core/push/tests/*.test.ts` stops at load: the test helper needs `OGW_DEFAULT_DB` and the server build data folder `OGW_SERVER_DATA`, which the core test runner provides and this worktree does not have. Everything above was checked by reading the code. There was no finding to check and no restored defect to run
