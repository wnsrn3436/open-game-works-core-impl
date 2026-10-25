# review mailbox round 1

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

- Tests were not run: the checkout has no `node_modules` (`server/` and the root have none), so the mailbox tests under the new random user IDs of `storage.create_user` (server/core/storage/rows.ts:57, server/core/storage/public_code.ts:16) were checked only by reading. In server/core/mailbox/tests/*.ts no assert depends on the order or the value of user IDs (the only sorts are by mail ID and item ID, server/core/mailbox/tests/helpers.ts:236, server/core/mailbox/tests/claim.test.ts:16)
- The range changes no file of server/core/mailbox other than server/core/mailbox/tests/helpers.ts:131 (the new `NewUser` output of `create_user`). Range changes that mailbox reaches were checked: `storage` `create_user`/`get_user_record`/schema version 2 (mailbox does not call them outside the test helper and reads no `user` table column), `routing` request start order (server/core/routing/spec_tables.ts:66, unchanged for mailbox), and `run_user_transaction` `WITHDRAWN` handling used by `on_request_start` (server/core/mailbox/index.ts:458, unchanged). User IDs now reach up to 2^53 − 1, within the `int64` columns and the `int64` reader of server/core/mailbox/tables.ts:68
- Mailbox code that the range does not reach was not re-reviewed for problems that existed before the range
