# review guild round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | open | The spec decision R1-1 asked for is now in the harness (open-game-works-core commit 52e5ea3): guild `### tables` lists `guild_cooldown` with expiry column `none` and says "The cooldown is judged with the request time, so `guild_cooldown` has no expiry column: a row whose `ends_at` the request time has reached stays until the next leave or kick of that user overwrites it or `remove_user` deletes it". The code still registers `ends_at` as the expiry column: server/core/guild/tables.ts:63 `storage.register_table(COOLDOWN, 'game', [...], ['user_id'], 'ends_at', null, 'user_id')` (5th argument is the expiry column, storage `register_table`). So `sweep_expired` still deletes `guild_cooldown` rows with `ends_at` <= `clock_now` (server/core/storage/rows.ts:372, rows.ts:398), and the run path of R1-1 is unchanged (DEV offset −25h, leave, `GUILD_COOLDOWN` before the sweep and success after it at the same request time). Guild source is unchanged in the range (only tests changed). This is now a code fix, not a spec change: pass `null` as the expiry column of `guild_cooldown` at tables.ts:63 (with the schema change of the registered table), and add a test that a `guild_cooldown` row whose `ends_at` is at or before `clock_now` but after the request time is not deleted by `sweep_expired` and still gives `GUILD_COOLDOWN`. Severity medium: it differs from the defining documents |
| R1-2 | fixed | New test roles.test.ts:185 `active_at > is set to the request time of the acting member by AcceptGuildJoinRequest, RejectGuildJoinRequest, KickGuildMember and SetGuildMemberRole, and not for the target`. Restored in a temporary copy (git archive of HEAD), one at a time, by replacing each `touch(...)` line with a comment: rpc.ts:247 fails at roles.test.ts:194, rpc.ts:255 fails at roles.test.ts:198, rpc.ts:284 fails at roles.test.ts:201, rpc.ts:298 fails at roles.test.ts:205 (SQLite) |
| R1-3 | fixed | New tests create.test.ts:46 `CreateGuild > deletes every join request row of the user who creates the guild` and admin.test.ts:138 `import_guild > deletes every join request row of the members it writes, and keeps those of other users`. Restored in a temporary copy by replacing `db.delete_requests_of_user(member.user_id);` at members.ts:61 with a comment: create.test.ts:57 and admin.test.ts:147 fail (`requests(kit)` has the extra rows) (SQLite) |
| R1-4 | fixed | New test roles.test.ts:99 `SetGuildMemberRole > is GUILD_NOT_MEMBER for a target with no guild and for a member of another guild, and changes nothing`. Restored in a temporary copy by changing rpc.ts:294 to `return PERMISSION;`: roles.test.ts:107 fails (expected 76 to be 71) (SQLite) |
| R1-5 | fixed | New test locks.test.ts:239 `guild row lock > makes the KickGuildMember of an Officer whose row moves to another guild while it waits for the first guild row lock GUILD_NOT_MEMBER, without a change (PostgreSQL)`. Restored in a temporary copy by changing rpc.ts:85 to `if (me === null \|\| guild === null) return NOT_MEMBER;`: locks.test.ts:258 fails (the kick returns 0 instead of `GUILD_NOT_MEMBER`) on PostgreSQL |
| R1-6 | fixed | create.test.ts:209-211 now read `join_value` 5 and 9 from the guild row and 9 from `GetGuild` after `UpdateGuild`. Restored in a temporary copy by removing `join_value = $4, ` from the `UPDATE` at tables.ts:229: create.test.ts:209 fails (SQLite) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | server/core/guild/tables.ts:63 still registers `ends_at` as the expiry column of `guild_cooldown`, which guild `### tables` now says has none; `sweep_expired` deletes those rows by `clock_now` |
| D2 | fixed | none | Removing each of the four `touch` calls (rpc.ts:247, 255, 284, 298) one at a time makes roles.test.ts:185 fail |
| D3 | fixed | none | Removing members.ts:61 makes create.test.ts:46 and admin.test.ts:138 fail |
| D4 | fixed | none | Changing rpc.ts:294 to `PERMISSION` makes roles.test.ts:99 fail |
| D5 | fixed | none | Changing rpc.ts:85 to `me === null \|\| guild === null` makes locks.test.ts:239 fail on PostgreSQL |
| D6 | fixed | none | Removing `join_value` from the `UPDATE` at tables.ts:229 makes create.test.ts:197 fail |

## must fix

none

## unknown

- In the commit range the guild module changed only its tests (admin, create, kit, locks, roles); no guild implementation file and no file of its dependency modules (storage, server-time, logging, validation, public-profile) changed. The review covered those test changes, the code they reach, and the six `## debt` items. The rest of the module was not reviewed again.
- Input `## spec changes` is `none`, but guild.md changed in the harness after round 1 (commit 52e5ea3, `guild_cooldown` expiry column set to `none`). R1-1 / D1 was judged against the current guild.md. The other changes of that commit to guild.md were not compared with the code.
- Baseline runs on the unchanged temporary copy: all 89 guild tests pass on SQLite and on PostgreSQL (PostgreSQL 18.6 in a local container). The temporary copy used `server/build/data` from another core worktree on this host (`worktrees/_core/agent-mw2kdoipcf4390`, a different commit) because this checkout has no built data; the baseline pass shows it was compatible with the guild tests.
- The R1-5 restoration ran only on PostgreSQL, because that test is PostgreSQL only (on SQLite write transactions are serialized and the interleaving cannot happen). The other restorations ran only on SQLite, and only the test file that holds the new test.
