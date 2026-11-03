# review guild round 1

## findings

none

## previous

none

## out of scope

- server/core/guild/rpc.ts:247: medium The write of `active_at` as request time has no test in `AcceptGuildJoinRequest` (rpc.ts:247), `RejectGuildJoinRequest` (rpc.ts:255), `KickGuildMember` (rpc.ts:284) and `SetGuildMemberRole` (rpc.ts:298), although `### leader succession` of the spec requires it for every handling that finds the guild by my `guild_member` row. `describe('active_at')` at tests/roles.test.ts:152 checks only `GetMyGuild` and `UpdateGuild`. Removing each of the four `touch` calls in a temporary copy, one at a time, left all 84 guild tests passing on SQLite and PostgreSQL. The code does the write; the test is what is missing
- server/core/guild/members.ts:61: medium Deleting the join request rows of the members in `insert_new_guild` (`CreateGuild` step 8, `import_guild` step 7) has no test. Removing that line in a temporary copy left all 84 guild tests passing on SQLite and PostgreSQL. With the line removed, a user who has a join request and runs `CreateGuild` would be a member with a remaining join request row, which breaks the rule of `### join` that the applicant of a remaining join request row is not a guild member
- server/core/guild/rpc.ts:294: medium `SetGuildMemberRole` with a target that is not a member of the same guild has no test of its `GUILD_NOT_MEMBER` result, which `### leave, kick, role` sets. Changing the return value on that line to `GUILD_PERMISSION` in a temporary copy left all 84 guild tests passing on SQLite and PostgreSQL. The same change on the `KickGuildMember` line (rpc.ts:279) makes a test fail
- server/core/guild/rpc.ts:85: medium The failure path of `### tables` in which my re-read `guild_member` row has a guild ID that differs from the locked guild has no test. Only the path in which the row no longer exists is tested (tests/locks.test.ts:195, tests/locks.test.ts:218). Changing the check to `me === null || guild === null` in a temporary copy left all 84 guild tests passing on SQLite and PostgreSQL. The path is reachable outside PROD: this handling reads `first`, a Leader kicks me, admin operation `import_guild` puts me in a new guild and commits, then this handling gets the lock of the first guild. With that change the handling would continue on the first guild with my row of the other guild. An accept by another guild does not reach it, because a member has no join request row and my own requests wait for this user transaction
- server/core/guild/tables.ts:229: medium `UpdateGuild` writing `join_value` has no test, although `### create and update` says it changes the three values. Removing `join_value` from that `UPDATE` in a temporary copy left all 84 guild tests passing on SQLite and PostgreSQL. The test helper `update_guild` (tests/kit.ts:554) has a `join_value` parameter, but no test reads the value back after an update

## debt

none

## must fix

none

## unknown

- The commit range changes no file of `server/core/guild/` and no file of `server/core/storage/`, `server-time/`, `logging/`, `validation/` or `public-profile/`, and input `## spec changes` is `none`. The diffs read in that range were `server/core/coupon/index.ts`, `server/core/matchmaker/realtime.ts`, `server/core/matchmaker/shared.ts`, `server/core/routing/tests/storage-sweep.test.ts`, `server/core/testing/dev/setting_types.ts`, the `settings/` files, `server/core/Dockerfile` and `core-spec/validation.json`. None of them has a `guild` key or a guild code path. The other files of the range (client, tools, other tests, `core-spec/` of other modules) were judged from the file list only
- All guild code and tests were read against the spec, so the problems above come from the whole target even though the range does not touch it. Every one of them existed before the range, which is why they are in `## out of scope` and not `## findings`
- The tests ran in a temporary copy of `server/` outside the checkout, with vitest by direct command and not with `ogw core test`. `server/build/data` of that copy came from `open-game-works-core-impl/` and was not rebuilt from this checkout. Without PostgreSQL, 75 of 84 tests pass and the other 9 fail only because they need `OGW_POSTGRESQL`. With a throwaway PostgreSQL 18.6 container and `OGW_DEFAULT_DB` `postgresql`, all 84 pass
- 48 single-line or single-statement defects were restored in temporary copies on SQLite. The 9 that passed there were run again on PostgreSQL, where `import_lock` was caught by a PostgreSQL-only test and the other 8 still passed. Those 8 are the ones written above. This covers only the defects tried, so other behavior of the spec can still lack a test. The `by_role` and `by_seniority` user ID tie breaks were not tried, because the rows are already read in user ID order and a stable sort would give the same result
- A lock wait exceeded in a core rpc returns `INTERNAL` from the guild handler (e.g. rpc.ts:82), so `routing` writes no separate `kind` `error` log (`server/core/routing/pipeline.ts:720`). It writes only the `request` log, whose level `logging` sets to `error` for a request that ended with `INTERNAL`. Whether that satisfies "`error` log by `routing`" in the `## error` table of the spec was not settled, and no test asserts it. `friend` has the same pattern. It is not written as a problem, because the reading is not certain enough
- `SetGuildMemberRole` of a target that is already `Officer`, while the other `Officer` count is at the limit or above, succeeds without a change (members.ts:20). The spec bullet of `SetGuildMemberRole` could be read as `GUILD_OFFICER_LIMIT`, and the role change bullet says it succeeds before the count check. The code follows the second, and it is not written as a problem
- The core tests of `chat`, `ranking` and `auth`, which call guild, were not run. Their use of `lock_guild`, `list_member_ids`, `get_guild_infos`, `register_disband_listener` and `remove_user` was checked only through the guild tests and by reading `server/core/guild/`
- Behavior under real concurrent load, beyond the concurrency tests in `tests/locks.test.ts`, `tests/withdraw.test.ts` and `tests/join.test.ts`, was checked by reading the lock order only. No deadlock was found by reading, and no stress run was done
