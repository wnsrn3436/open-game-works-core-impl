# review: public-profile round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/public-profile/index.ts:272 | The public-profile spec error table sets a failure path: "the user transaction of `count_find_attempt` is `FAILED` → `INTERNAL`, `error` log", and `### find by public code` says the count does not increase then. Neither test file goes through it: `grep -n "INTERNAL\|FAILED\|lock_holder" server/core/public-profile/tests/*.ts` finds only the hook `INTERNAL` tests (requests.test.ts:144-158) and the `on_request_start` lock tests (last-active.test.ts:30, 77). The only `count_find_attempt` test (profiles.test.ts:247-257) covers `UNAUTHORIZED`, `pass` and `RATE_LIMITED`. So changing lines 272-275 (e.g. returning `'pass'` or `UNAUTHORIZED` on `FAILED`, or dropping the `write_error`) fails no test | Add a test like coupon's `count_redeem_attempt` FAILED test (server/core/coupon/tests/expiry.test.ts:55-74): with a short `storage.userLockWaitMs`, hold the user lock with `hold_user_lock` (tests/helpers.ts:162), check that `count_find_attempt` gives `INTERNAL`, that the `public_profile_find_counter` row is unchanged after the holder rolls back, and that there is exactly one `error` log with that user ID | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The tests were not run: this worktree has no `node_modules` under `server/`. Whether the existing tests pass on SQLite and PostgreSQL was not checked
- The `COUNT_FIND` upsert (repeated `$2`, `RETURNING count`) was read against the `storage` rules for counter tables but not run on PostgreSQL
- The other modules changed in this range (`auth`, `storage`, `routing`, `friend`, `guild` and others) were read only where they call public-profile or where public-profile calls them (`storage.find_user_by_public_code`, `storage.is_public_code_input`, `storage.get_user_record`, the `routing` request prepare of `core/FindUserByPublicCode`, `server-time.get_window_start`). Their other changes were not reviewed
- Retries of `FindUserByPublicCode` with the same request ID: `routing` runs the request prepare again for every send (pipeline.ts:632-641 skips it only for `core/RedeemCoupon`), so a retry counts again. Neither the public-profile spec nor the code it was checked against says whether a retry counts as another find, so this is not a finding
