# review public-profile round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R4-1 | fixed | server/core/public-profile/tests/profiles.test.ts:172-185 now starts the instance with `{ 'public-profile.maxRequestCount': 2 }` and asserts the entries [A, B] and one `build_public_profile` call per user (A, B). Restored in a temporary copy of the checkout (git archive of HEAD, sqlite, server build data of `open-game-works-core-impl/server/build/data`) by changing server/core/public-profile/index.ts:213 from `chunks([...new Set(user_ids)].sort(compare), max_request_count)` to `chunks([...user_ids].sort(compare), max_request_count)`: the test at profiles.test.ts:172 failed at :183 (entries had 3 items, B twice), 1 failed and 40 passed. With the current code all 41 tests of server/core/public-profile/tests/ pass. |

## out of scope

none

## debt

none

## must fix

none

## unknown

- In the commit range, only server/core/public-profile/tests/profiles.test.ts and records/review-debt/public-profile.json changed for this target; server/core/public-profile/index.ts did not change. The other changed files (other modules' code, tests and records) were not reviewed.
- Test runs used only `OGW_DEFAULT_DB=sqlite`. PostgreSQL runs were not done; the core agent report states the mutation check also failed on PostgreSQL, which was not reproduced here.
