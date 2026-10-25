# review ranking round 1

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

- The only change under `server/core/ranking/` in the range is `server/core/ranking/tests/withdrawal.test.ts:29-30`: the expected retry row order is now the two user IDs sorted ascending, which matches `ORDER BY user_id` of `retry_rows` (`server/core/ranking/tests/support.ts:281`) and of `read_due_retries` (`server/core/ranking/store.ts:426`), and the spec's "`user_id` ascending order" of reward retry. The comparator `x < y ? -1 : 1` orders bigints correctly
- The change in range that reaches ranking is that `storage.create_user` now picks random user IDs from 1 to below 2^53 (`server/core/storage/public_code.ts:16-21`, `server/core/storage/rows.ts:57-68`). Ranking stores user IDs only in `int64` columns and handles them as bigint (`server/core/ranking/store.ts:105-109`); it converts no user ID to a JS number. Ranking does not call `create_user`, `get_user_record`, `find_user_by_public_code` or `is_public_code_input`, so the changed signatures in `server/core/storage/index.ts` and `server/core/routing/module_api.ts` do not reach ranking code
- I checked the ranking tests that compare entries in an order that depends on the user ID (`tests/score.test.ts`, `tests/query.test.ts`, `tests/reward.test.ts`, `tests/event.test.ts`, `tests/guild.test.ts`, `tests/dev.test.ts`). Each one either gives distinct scores or distinct reached times, or has at most one retry row, so none depends on users being created in user ID order. Only `tests/withdrawal.test.ts` had two retry rows, and that test is the one fixed in the range
- I did not run the tests (`ogw core test`): the review does not write files outside `output`, and `ogw core test` regenerates and commits files. The pass or fail of the ranking tests on the range's head commit is not checked here
- The code of the dependency modules `mailbox`, `item-ledger`, `server-time`, `logging` and `live-event` changed in the range only in their test helpers, and the ranking paths that call them did not change. I did not review those modules' own code beyond what ranking calls
