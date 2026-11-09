# review iap round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit 1ece4b07 added server/core/iap/tests/gone.test.ts:167. The fake `iap-google` lookup is `GONE`, and `storage.run_game_transaction` returns `FAILED` for one call, which is the claim in `claim_only` (server/core/iap/notify.ts:285). The test asserts HTTP 500, exactly one new `error` log `iap store notification processing failed`, and an unchanged subscription record. It then sends the same notification ID `gc-n1` again and asserts that it is handled (HTTP 200, state `SUBSCRIPTION_STATE_REVOKED`). To restore the defect, a `git worktree add --detach` copy of 1e1285cb had server/core/iap/notify.ts:286 replaced with `return OK;`. `ogw core test server iap --file server/core/iap/tests/gone.test.ts` on that copy failed this test on SQLite and PostgreSQL with `AssertionError: expected 200 to be 500`. With the file restored, the same command passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The only server iap change in the range is the test file server/core/iap/tests/gone.test.ts. The other changes in the range (Godot client core tests and AuthCore, the item-ledger test server/core/item-ledger/tests/once-key-routing.test.ts, records) do not touch iap code or the iap call paths, so they were not reviewed here
- Only server/core/iap/tests/gone.test.ts was run. The whole iap suite and the dependent modules were not run in this review; the fix report says `ogw core test server iap admin-api auth matchmaker notice rating routing testing` passed on the commit
