# review fix friend round 1

## done

- `friend` server core tests: `server/core/friend/tests/list-search.test.ts`. No production code changed
- Added the test helper `by_id`, which sorts sessions by user ID and keeps the tuple type. Each test uses it to order its users by ID after login, so the insertion order is never the user ID order and the result no longer depends on the random user IDs

## spec proposals

none

## review

- R1-1: fixed. `server/core/friend/tests/list-search.test.ts:42-52`: the two tied users are sorted with `by_id`, the user with the larger ID sends first, and the test expects the smaller ID first (lines 62-63). Checked by removing `|| compare_ids(a.other_id, b.other_id)` from `server/core/friend/index.ts:365` in a temporary edit: the test failed in 4 of 4 runs (PostgreSQL run reported failing)
- R1-2: fixed. `server/core/friend/tests/list-search.test.ts:84-92`: the users other than A are sorted with `by_id`; the user A blocks and the user who blocks A are the two smallest IDs, so if either one were kept it would be in the first `friend.maxSearchResults` (2) results. Checked in temporary edits of `server/core/friend/index.ts:388`: with `is_blocked(ctx, me, id)` the test failed in 4 of 4 runs, and with `is_blocked(ctx, id, me)` it also failed in 4 of 4 runs (SQLite run reported failing)
- R1-3: fixed. `server/core/friend/tests/list-search.test.ts:130-145`: B and C are sorted with `by_id` so that B < C, C (the larger ID) becomes A's friend first, and the test expects `[id(b), id(c)]`. Checked by removing `ORDER BY other_id` from `SELECT_FRIEND_IDS` (`server/core/friend/index.ts:97`) in a temporary edit: the test failed in 4 of 4 runs (PostgreSQL run reported failing)

## unverified

- The mutation runs above were made before the last edit, which only changed the types (`by_id` keeps the tuple type and `TestSession` is imported). The test logic did not change after them. The last `ogw core test server auth chat friend matchmaker rating routing testing` passed on SQLite and PostgreSQL, and `ogw code check core` passed
- For each mutation the job output showed only the first failing database run, so I did not check that each mutation fails on both SQLite and PostgreSQL. The new order does not depend on the physical row order, so it should fail on both
