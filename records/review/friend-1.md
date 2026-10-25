# review friend round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/friend/tests/list-search.test.ts:44 | The GetFriends tie test (G then E send at the same time, expected user ID ascending) relied on E having the smaller ID. Since this range IDs are random (server/core/storage/public_code.ts:16), so the insertion order differs from the ID order in only half the runs. In a temporary copy, the tie-break `\|\| compare_ids(a.other_id, b.other_id)` was removed from server/core/friend/index.ts:365. The test then failed in 4 of 8 PostgreSQL runs and in 0 of 6 SQLite runs, because SQLite returns rows in primary key order | Make the user with the larger ID send first (order the sends by `id()`), so that physical order is never ID order and the test fails on the defect in every PostgreSQL run | no | 90 |
| R1-2 | test evidence | medium | server/core/friend/tests/list-search.test.ts:73 | `c` blocks `a`, which checks the "blocked by the other user" side of `is_blocked_either`. Only this test checks that side, and it now catches the defect only when `c` is among the 2 smallest IDs of {c,d,e,f}. Before this range `c` < `d,e,f` held every time. In a temporary copy, server/core/friend/index.ts:388 was changed to the one-direction check `is_blocked(ctx, me, id)`. The test failed in 3 of 8 SQLite runs | Pick the users after login so that the user who blocks `a` has a smaller ID than the users that are kept, or check that the blocked users are absent without relying on `maxSearchResults` | no | 90 |
| R1-3 | test evidence | medium | server/core/friend/tests/list-search.test.ts:137 | `list_friend_ids` ascending is checked with `ascending([b,c])`, and C became A's friend before B did. With random IDs the insertion order equals the ID order in half the runs. In a temporary copy, `ORDER BY other_id` was removed from SELECT_FRIEND_IDS (server/core/friend/index.ts:97). The test failed in 2 of 6 PostgreSQL runs and in 0 of 6 SQLite runs | Make the user with the larger ID become A's friend first | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Production code of `friend` did not change in this range. Its interaction with `public-profile.get_public_profiles` (which now fills `public_code`) and with random user IDs (lock order by bigint compare) was read but not tested beyond the existing friend tests. All 43 friend tests pass on SQLite. Unmutated tests were not run on PostgreSQL
- The mutation runs used `server/build/data` of `open-game-works-core-impl/` as `OGW_SERVER_DATA`, because this checkout has no built data
