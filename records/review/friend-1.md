# review friend round 1

## findings

none

## previous

none

## out of scope

- server/core/friend/index.ts:226: medium `create_friend` reads settings key `public-profile.maxRequestCount` and throws when it is missing, but that key is not in `## settings` of the friend spec nor in `core-spec/friend.json`, and `server-core` says `settings` holds the keys of `## settings` of that module spec. It works only because `module_settings` (server/core/routing/start_parts.ts:89) passes all merged settings. The use is also not needed: `public-profile` says `get_public_profiles` has no limit on the user ID count, while `profiles_of` (server/core/friend/index.ts:293) splits the list by that key. Exists since before the range
- server/core/friend/index.ts:371: medium behavior of the spec without a test: `GetFriends` leaves out rows without a profile. No friend test or other core test calls `GetFriends` with a link row whose other user has no profile; the only other caller, server/core/auth/tests/withdraw.test.ts:80, runs after the rows are deleted. Changing `continue` to a throw is not reached by any test
- server/core/friend/index.ts:407: medium failure path of the spec `## error` without a test: "a link row that `remove_user` read again has an other user that was not locked" is `FAILED`. The only test near it, server/core/friend/tests/block-withdraw.test.ts:122, races `Withdraw` and `SendFriendRequest` by timing and accepts both outcomes, so a run can pass without entering this branch, and no test holds the order that makes it happen. Removing this line is not detected reliably
- proto/ogw/core.proto:1307: medium behavior of the spec without a test: `SearchUsers` is `INVALID_REQUEST` for a `nickname` longer than `nickname.maxLength` (`(ogw.v)` `max_chars_key`). server/core/friend/tests/helpers.ts:154 is the only sender of `core/SearchUsers` in the core tests, and server/core/friend/tests/list-search.test.ts sends no over-length nickname. Without the annotation, `find_user_ids_by_nickname` returns an empty list, so the response would be success with no users and no test would fail
- server/core/friend/index.ts:315: medium processing order of the spec without a test: no test has two failure conditions at once, so swapping steps passes. Cases not run: a target that is both withdrawn and blocked (`USER_NOT_FOUND` before `BLOCKED`, lines 315-316), `FRIEND_LIMIT` with `FRIEND_REQUEST_LIMIT` and with `FRIEND_TARGET_LIMIT` in step 7 of `SendFriendRequest` (lines 331-334), and both users at `friend.maxFriends` in `AcceptFriendRequest` (lines 260-262). server/core/friend/tests/request.test.ts:163 and the limit tests after it reach one limit at a time

## debt

none

## must fix

none

## unknown

- The commit range changes no file of server/core/friend, its tests, its contract in proto/ogw/core.proto, the `friend.*`, `nickname.*`, `public-profile.*` and `chat.allowChild` settings, or the code of its dependency modules. The changes that reach all modules (settings/core-settings.json, settings/core-settings.schema.json, server/core/testing/dev/setting_types.ts, core-spec files of other modules) add or remove keys of other modules only. The whole of server/core/friend was read against the spec for `## out of scope`
- `ogw core test server friend` passed on the checked commit. It may have used a kept result of the same key. The defects in `## out of scope` were judged by reading the code and tests; no defect was restored in a copy and run, so "no test would fail" there is from reading, not from a run
- "`routing` leaves an `error` log" for a count row lock wait in a core rpc: friend returns `INTERNAL`, and routing writes no `kind: error` line for a returned `CoreError` (server/core/routing/pipeline.ts:720); only the `request` log has level `error` (`logging`). Whether that level meets the friend `## error` row is not settled by the defining documents, so it is not written as a problem. No friend test checks the log
- The code of `nickname`, `public-profile`, `block-report`, `storage`, `auth` and `routing` was read only where friend calls it; those modules are other review targets
- Concurrency on PostgreSQL was not observed beyond the core test run, which covers SQLite and PostgreSQL
