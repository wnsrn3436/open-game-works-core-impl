# review: item-ledger round 1

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

- In the commit range, the only change under `server/core/item-ledger/` is `server/core/item-ledger/tests/helpers.ts:178`, which now takes `.user_id` from the `NewUser` that `storage.create_user` returns (`server/core/storage/rows.ts:57`). It matches the new `Storage.create_user(tx): NewUser` signature (`server/core/storage/index.ts:162`).
- I checked how item-ledger code depends on the storage changes in the range (random user IDs below 2^53 and the new `public_code` field of `UserRecord`). `server/core/item-ledger/ledger.ts:319` reads only `created_at` from `get_user_record`. The history and once-key queries (`server/core/item-ledger/history.ts:96-143`) bind `user_id` as a bigint and read it back with `int64`. No item-ledger code orders users by ID or converts `user_id` to a JS number, so the change in how user IDs are picked does not affect item-ledger behavior.
- `server/core/item-ledger/tests/history.test.ts:85` uses `user_id + 1000n` as a user ID with no history. Since user IDs are now random, this value is not certain to belong to no user. But each test env creates only a few users out of 2^53 IDs, so a collision is practically impossible. I did not record it as a finding.
- I did not run the item-ledger tests. This worktree has no installed dependencies and `server/package.json` defines no test script, so test results were not checked here.
- I did not re-review item-ledger code outside the range, because the commit range does not change it and `## spec changes` is `none`.
