# review friend round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/friend/tests/list-search.test.ts:42-63: the two tied users are sorted with `by_id`, the larger ID sends first and the test expects the smaller ID first. In a temporary copy of the checkout, `\|\| compare_ids(a.other_id, b.other_id)` was removed from server/core/friend/index.ts:365. The test `returns Friend, Received, Sent in that order; ...` failed in 4 of 4 PostgreSQL runs. It passed in 4 of 4 SQLite runs, because SQLite returns the rows of `SELECT_LINKS` in primary key order (`other_id` ascending), so the ID order holds without the tie-break. Each module core test also runs on PostgreSQL, so the defect is caught every time |
| R1-2 | fixed | server/core/friend/tests/list-search.test.ts:84-92: the user that A blocks and the user that blocks A are the two smallest IDs of the others, so a kept one would be in the first 2 results. In a temporary copy, `!block.is_blocked_either(ctx, me, id)` at server/core/friend/index.ts:388 was changed to `!block.is_blocked(ctx, me, id)`. The SearchUsers limit test failed in 4 of 4 SQLite runs and 4 of 4 PostgreSQL runs. With `!block.is_blocked(ctx, id, me)` it failed in 4 of 4 SQLite runs and 4 of 4 PostgreSQL runs |
| R1-3 | fixed | server/core/friend/tests/list-search.test.ts:130-145: B and C are sorted with `by_id`, C (the larger ID) becomes A's friend first, and the test expects `[id(b), id(c)]`. In a temporary copy, `ORDER BY other_id` was removed from `SELECT_FRIEND_IDS` (server/core/friend/index.ts:97). The test `are_friends is true only for Friend rows, ...` failed in 4 of 4 PostgreSQL runs. It passed in 4 of 4 SQLite runs, because SQLite reads the rows in primary key order. Each module core test also runs on PostgreSQL, so the defect is caught every time |

## out of scope

none

## debt

none

## must fix

none

## unknown

- In this range, the only file of `friend` that changed is server/core/friend/tests/list-search.test.ts. The change to server/core/storage/schema.ts (the start fill retries after a unique violation on PostgreSQL) was read. `friend` does not call that code, and it is reviewed under `storage`
- The tests ran in a temporary copy of the checkout (`git archive HEAD`) with vitest directly, not with `ogw core test`. `OGW_SERVER_DATA` was `server/build/data` of `open-game-works-core-impl/`, because this checkout has no built data. PostgreSQL was a throwaway container of harness settings `tools.postgresql` (18.6). Unmutated, all 43 friend tests passed on SQLite and on PostgreSQL
- The mutations that fail only on PostgreSQL (R1-1, R1-3) rely on PostgreSQL returning a sequential scan in heap (insertion and update) order. That order held in every run but PostgreSQL does not guarantee it
