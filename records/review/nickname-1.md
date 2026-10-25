# review nickname round 1

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

- The tests were not run: `server/` of this checkout has no `node_modules`. The changed assertions were checked by reading only
- In the range, `server/core/nickname/index.ts` did not change; only `server/core/nickname/tests/restart.test.ts` and `server/core/nickname/tests/set-nickname.test.ts` changed. The changes in the range that reach nickname are the `storage` ones: `create_user` now returns `{user_id, public_code}` (`server/core/storage/rows.ts:57`), and user IDs are now secure random below 2^53 (`server/core/storage/public_code.ts:16`), not sequential. Checked against those changes: the `ORDER BY user_id` of `get_nicknames` (`server/core/nickname/index.ts:283`) and of the nickname lookup (`server/core/nickname/index.ts:73`) runs on the `int64` column `user_id`, so the order is numeric and does not depend on insert order. The expected lists in `restart.test.ts:102`, `restart.test.ts:112`, `set-nickname.test.ts:100`, `lookup.test.ts:17`, `lookup.test.ts:45`, `admin.test.ts:124` and `admin.test.ts:137` are sorted by user ID with a `bigint` comparison, so they no longer assume the creation order. `restart.test.ts:54` reads `.user_id` from the new `create_user` result, and a `bigint` result of `run_game_transaction` is not taken as a failure code (`server/core/storage/tx.ts:45`)
- `lookup.test.ts:29` expects `get_nicknames(ctx, [1n, 2n])` to be empty. Now that user IDs are random, this holds only while no test user gets user ID 1 or 2 (chance about 2^-52 per user). Not written as a finding because of that chance
- The nickname code that did not change in the range was read for problems that the range's changes cause or reveal, and none were found. It was not re-reviewed as a whole: the commit range is not `none`
