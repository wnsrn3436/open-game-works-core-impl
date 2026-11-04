# review friend round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/friend/index.ts:220-226 no longer reads `public-profile.maxRequestCount`, `profiles_of` is gone, and `GetFriends` calls `profile.get_public_profiles` once with every link row's other user (index.ts:359). `grep maxRequestCount` finds it only in the friend test list-search.test.ts:71-72, which sets `public-profile.maxRequestCount` 2 and still passes, so public-profile splits the list itself as `public-profile.md` says |
| R1-2 | fixed | New test server/core/friend/tests/list-search.test.ts:83-105 writes a newest `Friend` link row whose other user ID (2^63−1) no user has, and asserts that `GetFriends` lists only B and C in order. Restored in a temporary copy of the checkout (git archive of HEAD in the scratchpad, friend tests run with vitest on SQLite): (a) `if (entry === undefined) continue;` at index.ts:363 replaced with a throw, and (b) that line deleted so the entry is pushed without a profile. In both, `GetFriends without a profile > leaves out a link row whose other user has no profile and keeps the other rows` failed and the other 50 tests passed |
| R1-3 | fixed | New test server/core/friend/tests/block-withdraw.test.ts:167-193 spies on `storage.lock_game_row` and, at A's first `friend_count` lock (step 2 of `remove_user`), writes the C→A request pair in A's transaction, so step 3 finds an other user it did not lock. The run is deterministic: it asserts the spy ran, `Withdraw` is `INTERNAL`, `withdrawn_at` is null and the tables are unchanged. Restored in the temporary copy by deleting the step 3 check `if (links.some((link) => !lockset.has(link.other_id))) return 'FAILED';` (index.ts:399): `Withdraw whose second read finds a link row with an other user it did not lock is INTERNAL and changes nothing` failed, the other 50 passed |
| R1-4 | fixed | New test server/core/friend/tests/list-search.test.ts:130-145 sends `nickname.maxLength` + 1 ASCII characters and + 1 emoji (`INVALID_REQUEST`) and exactly `nickname.maxLength` of each (success, and the ASCII one finds the user). proto/ogw/core.proto:1307 still has `max_chars_key: "nickname.maxLength"`. Restored in the temporary copy by removing `max_chars: 12` from `rules_CoreContract_SearchUsersRequest` in server/generated/contract/core_contract.ts:6004 (what the generated code is without the annotation): `a nickname of nickname.maxLength + 1 code points is INVALID_REQUEST, ...` failed with `expected +0 to be 1`, the other 50 passed |
| R1-5 | fixed | New tests block-withdraw.test.ts:155-165, request.test.ts:211-247. Restored in the temporary copy one at a time, each run failing the new test named and passing the other tests: swap of the `USER_NOT_FOUND` and `BLOCKED` checks (index.ts:307-308) failed `a request to a withdrawn user whom the caller blocked is USER_NOT_FOUND, not BLOCKED`; swap of the `FRIEND_LIMIT` and `FRIEND_REQUEST_LIMIT` checks (index.ts:323-324) failed `... at friend.maxFriends and friend.maxSentRequests to a user at both target limits is FRIEND_LIMIT`; the target check moved before both caller checks failed 2 tests; the target check moved between the two caller checks failed `... at friend.maxSentRequests to a user at both target limits is FRIEND_REQUEST_LIMIT`; swap of the two checks of `accept` (index.ts:260-263) failed `accepting, or a request answering a pending request, when both users are at friend.maxFriends is FRIEND_LIMIT` |
| R1-6 | fixed | `lock_pair` (server/core/friend/index.ts:251-256) throws on a `friend_count` lock wait timeout, and every core rpc (index.ts:283, 304, 342) and the block listener (index.ts:293) call it without catching, so the throw reaches `routing`, which writes the `unhandled exception` `error` log (server/core/routing/pipeline.ts:220) and ends with `INTERNAL`. New test server/core/friend/tests/lock-timeout.test.ts:83-103 asserts `INTERNAL`, one `kind` `error` line carrying the request name, unchanged state and no hook call for all six requests. Restored in the temporary copy by catching the throw in `SendFriendRequest` and returning `CORE_ERROR_INTERNAL` as before: that test failed, the other 50 passed |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: server/core/friend/index.ts no longer reads `public-profile.maxRequestCount` and calls `get_public_profiles` once (index.ts:359) |
| D2 | fixed | none | Same as R1-2: list-search.test.ts:83-105 reaches index.ts:363 with `entry === undefined` and fails when that branch is changed to a throw or removed |
| D3 | fixed | none | Same as R1-3: block-withdraw.test.ts:167-193 holds the order deterministically with a spy and fails when the step 3 check is removed |
| D4 | fixed | none | Same as R1-4: list-search.test.ts:130-145 fails when the `max_chars` rule of `SearchUsersRequest.nickname` is removed |
| D5 | fixed | none | Same as R1-5: every reorder named in the item fails a new test |
| D6 | fixed | none | Same as R1-6: a `friend_count` lock wait timeout in a core rpc throws to `routing`, which leaves the `error` log; lock-timeout.test.ts:83-103 checks that log line |

## must fix

none

## unknown

- The friend tests were run only on SQLite, in a temporary copy of HEAD with the built data copied from `open-game-works-core-impl/server/build/data`; the PostgreSQL run was not done in this review. The hold-based tests of server/core/friend/tests/lock-timeout.test.ts check the friend `error` log only on PostgreSQL (`while_held`), so that assertion was not run here; the core agent report says it passed. The spy-based test at lock-timeout.test.ts:83 does not depend on the DB kind and was run.
- The tests of the modules that depend on friend (auth, chat, matchmaker, rating, routing, testing) were not run in this review; `ogw review run` runs them after each fix.
- Outside `server/core/friend/`, the commit range changes other modules (godot client core, chat, gacha, game-update, guild and others) that are not friend, the modules it depends on, or code friend calls; they were not reviewed.
