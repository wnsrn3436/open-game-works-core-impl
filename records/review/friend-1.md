# review friend round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/friend/index.ts:226 | Input D1, still present. `create_friend` reads `public-profile.maxRequestCount` with `integer_setting` (throws when missing, line 226) and `max_profiles < 1` throws (line 228). That key is not in `## settings` of `open-game-works-core/skills/server-core/modules/friend.md` nor in core-spec/friend.json `settings`, while `server-core` `## module` says `settings` holds the keys of `## settings` of that module spec. `profiles_of` (lines 291-297) splits the list by this key although `public-profile.md:57` says `get_public_profiles` has no limit on the user ID count and splits by that key itself (server/core/public-profile/index.ts:56,162) | Remove the setting read and `profiles_of`; call `profile.get_public_profiles(ctx, ids)` once in `GetFriends` | no | 95 |
| R1-2 | test evidence | medium | server/core/friend/index.ts:371 | Input D2, still present. The spec (`friend.md:116`) says rows without a profile are left out of `GetFriends`. The only callers of `core/GetFriends` in the core tests are server/core/friend/tests/list-search.test.ts:56,75 (every other user is active) and server/core/auth/tests/withdraw.test.ts:80 (runs after `remove_user` deleted the rows). No test reaches line 371 with `entry === undefined`, so replacing `continue` with a throw or with pushing an entry without a profile passes every test | Add a test whose link row has an other user without a profile (e.g. a row whose other user record is made withdrawn without `remove_user`, or a `public-profile` hook that leaves the user out) and assert that the row is left out and the other rows remain | no | 90 |
| R1-3 | test evidence | medium | server/core/friend/index.ts:407 | Input D3, still present. The `## error` row "a link row that `remove_user` read again has an other user that was not locked" → `FAILED` has no test that holds the order making it happen. server/core/friend/tests/block-withdraw.test.ts:122-143 races `Withdraw` and `SendFriendRequest` by timing and accepts both `0` and `INTERNAL` (line 130), so a run where the request commits before the first read or after the commit passes without entering line 407. Deleting line 407 is not detected reliably | Add a test that inserts a link row with an unlocked other user between step 1 and step 3 deterministically (e.g. a spy on `storage.lock_game_row` or a `DbHandle.query` hook that commits a `SendFriendRequest` from another connection after the first read) and asserts `remove_user` is `FAILED` and the state is unchanged | no | 90 |
| R1-4 | test evidence | medium | proto/ogw/core.proto:1307 | Input D4, still present. `SearchUsersRequest.nickname` has `(ogw.v)` `max_chars_key: "nickname.maxLength"` (`friend.md:51`), so a longer nickname is `INVALID_REQUEST`. server/core/friend/tests/helpers.ts:151-155 is the only sender of `core/SearchUsers` in the core tests, and list-search.test.ts sends only `Twin`, `twin`, `Nobody`. Removing the annotation makes an over-length nickname succeed with an empty list (`find_user_ids_by_nickname` finds nobody), and no test fails | Add a test that sends a nickname of `nickname.maxLength` + 1 code points and asserts `INVALID_REQUEST`, and one of exactly `nickname.maxLength` code points that succeeds | no | 90 |
| R1-5 | test evidence | medium | server/core/friend/index.ts:315 | Input D5, still present. The processing order of `SendFriendRequest` (`friend.md:89-98`) and `AcceptFriendRequest` (`friend.md:100-106`) is not tested with two failure conditions at once. The tests in server/core/friend/tests/request.test.ts:162-207 and block-withdraw.test.ts:34-42,145-151 each reach one condition: no test has a target that is both withdrawn and blocked (swap lines 315-316 passes), a caller at `friend.maxFriends` and `friend.maxSentRequests` together or a caller at `friend.maxFriends` with a target at its limit (reordering lines 331-334 passes), or both users at `friend.maxFriends` in an accept (swapping lines 260 and 262 passes) | Add tests where two failure conditions hold at once and assert the earlier one in the spec order: `USER_NOT_FOUND` over `BLOCKED`, `FRIEND_LIMIT` over `FRIEND_REQUEST_LIMIT` and over `FRIEND_TARGET_LIMIT`, `FRIEND_LIMIT` over `FRIEND_TARGET_LIMIT` in `AcceptFriendRequest` | no | 90 |
| R1-6 | spec | medium | server/core/friend/index.ts:282 | Input D6, still present. On a `friend_count` lock wait timeout, `drop` (line 282, used by decline, cancel, remove), `SendFriendRequest` (line 312) and `AcceptFriendRequest` (line 350) return `CORE_ERROR_INTERNAL` as a value. In server/core/routing/pipeline.ts:670-675 a numeric handler result is returned to the transaction, and `finish` (pipeline.ts:694-721) reaches only `this.fail(...)` at line 720 for it, without `error_log`. So the only line is the `request` log at level `error` (logging `### server log`), and no `kind` `error` line is written, while `open-game-works-core/skills/server-core/modules/friend.md:163` says `routing` leaves an `error` log; the routing spec leaves an `error` log only for its listed cases (`routing.md:208-218`), not for a handler that returns `INTERNAL`. The block listener under the same lock wait throws (index.ts:301) and does get the `error` log of an unhandled exception (pipeline.ts:218-221). server/core/friend/tests/lock-timeout.test.ts checks only the error code and reads no log | Make the core rpc handlers throw on a lock wait timeout, as the block listener does, so `routing` leaves the `error` log with the stack trace; add an assert on the `error` log line to lock-timeout.test.ts | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | server/core/friend/index.ts:226,228,291-297 unchanged; core-spec/friend.json `settings` still has no `public-profile.maxRequestCount` |
| D2 | open | R1-2 | server/core/friend/index.ts:371 unchanged; no core test calls `GetFriends` with a link row whose other user has no profile |
| D3 | open | R1-3 | server/core/friend/index.ts:407 unchanged; the only test near it is still the timing race at server/core/friend/tests/block-withdraw.test.ts:122 that accepts both outcomes |
| D4 | open | R1-4 | proto/ogw/core.proto:1307 unchanged; no core test sends an over-length `SearchUsers` nickname |
| D5 | open | R1-5 | server/core/friend/index.ts:260-262,315-316,331-334 unchanged; every limit and block test reaches one failure condition at a time |
| D6 | open | R1-6 | server/core/friend/index.ts:282,312,350 still return `CORE_ERROR_INTERNAL`; server/core/routing/pipeline.ts:720 still calls only `fail` for it |

## must fix

none

## unknown

- The commit range f8ed28b..f8ed28b is empty, so there are no changed places; the review covered the friend code and tests at f8ed28b for the input debt items only.
- D6 was not re-run on PostgreSQL in this round; it was checked by reading server/core/routing/pipeline.ts `transaction` and `finish`, which are unchanged since the reproduction written in the debt item.
- The tests were not run in this round, because no code changed and every debt item was checked by reading the code and the test files.
