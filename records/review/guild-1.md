# review guild round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | server/core/guild/core.ts:181 | Item D1. `cooldown_ends_at` judges the `guild_cooldown` row with `is_reached_strict(ctx, ends_at)` (request time), as guild `### tables` cooldown says, while `sweep_expired` deletes rows with `ends_at` <= `clock_now` (server/core/storage/rows.ts:372-373, rows.ts:399) and storage `### expiry` says such a row "counts as a row that does not exist, also before it is deleted". Run path: in DEV a user with cheat offset −25h leaves or is kicked; `remove_member` writes `ends_at` = request time + 86400000, about 1h before `clock_now`. Until `storage_sweep` runs, `JoinGuild`/`CreateGuild` give `GUILD_COOLDOWN` (core.ts:181, rpc.ts:55-57); after the sweep deletes the row the same requests succeed although request time is still before `ends_at`. Without an offset the same split happens between a request time and the sweep's later `clock_now`. Guild source and storage sweep unchanged for this path since the debt was written | Decide in the specs one time base for this table: judge the cooldown with `clock_now` (and write `ends_at` from `clock_now`), or exclude `guild_cooldown` from the storage expiry rule (no expiry column, delete in guild), then make code follow | yes | 90 |
| R1-2 | test evidence | medium | server/core/guild/rpc.ts:247 | Item D2. `### leader succession` requires `active_at` of my row to be written as request time by every handling that finds the guild by my `guild_member` row; tests/roles.test.ts:152-167 checks only `GetMyGuild` and `UpdateGuild`. In a temporary copy, commenting out `touch(...)` at rpc.ts:247 (`AcceptGuildJoinRequest`), rpc.ts:255 (`RejectGuildJoinRequest`), rpc.ts:284 (`KickGuildMember`) and rpc.ts:298 (`SetGuildMemberRole`), one at a time, left every SQLite guild test that passes on the unchanged copy passing | Add tests that advance time and check `active_at` of the acting member after a successful accept, reject, kick and role change | no | 95 |
| R1-3 | test evidence | medium | server/core/guild/members.ts:61 | Item D3. Deleting the members' join request rows in `insert_new_guild` (`CreateGuild` step 8, `import_guild` step 7) has no test. In a temporary copy, commenting out `db.delete_requests_of_user(member.user_id)` at members.ts:61 left every SQLite guild test that passes on the unchanged copy passing. With it removed, a user with a join request who runs `CreateGuild` is a member with a remaining join request row, against `### join` | Add tests: a user with a join request runs `CreateGuild`, and `import_guild` with a member that has a join request; then no join request row of that user remains | no | 95 |
| R1-4 | test evidence | medium | server/core/guild/rpc.ts:294 | Item D4. `SetGuildMemberRole` with a target that is not a member of the same guild has no test of `GUILD_NOT_MEMBER` (`### leave, kick, role`). In a temporary copy, changing rpc.ts:294 to `return PERMISSION` left every SQLite guild test that passes on the unchanged copy passing; the same change at rpc.ts:279 (`KickGuildMember`) failed tests/roles.test.ts "is GUILD_PERMISSION when an Officer kicks an Officer..." | Add a test that `SetGuildMemberRole` on an outsider and on a member of another guild gives `GUILD_NOT_MEMBER` and changes nothing | no | 95 |
| R1-5 | test evidence | medium | server/core/guild/rpc.ts:85 | Item D5. The `### tables` failure path in which my re-read `guild_member` row has a guild ID that differs from the locked guild has no test; tests/locks.test.ts:195 and tests/locks.test.ts:218 cover only the row that no longer exists. In a temporary copy, changing rpc.ts:85 to `if (me === null \|\| guild === null) return NOT_MEMBER;` left every SQLite guild test that passes on the unchanged copy passing. Reachable outside PROD: the handling reads `first`, a Leader kicks me, `import_guild` puts me in a new guild and commits, then the handling gets the first guild's lock and would continue with my row of the other guild | Add a lock-ordering test in which my row moves to another guild before the handling gets the first guild's lock, and check `GUILD_NOT_MEMBER` with no change | no | 90 |
| R1-6 | test evidence | medium | server/core/guild/tables.ts:229 | Item D6. `UpdateGuild` writing `join_value` (`### create and update`: it changes the three values) has no test. In a temporary copy, removing `join_value = $4, ` from the `UPDATE` at tables.ts:229 left every SQLite guild test that passes on the unchanged copy passing. The helper `update_guild` (tests/kit.ts:554) takes `join_value`, but no test reads it back after an update | Add a test that reads `join_value` (guild row or `GetGuild`) after `UpdateGuild` with a new value | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | server/core/guild/core.ts:181 still uses `is_reached_strict` while storage sweeps by `clock_now`; guild and storage specs still disagree |
| D2 | open | R1-2 | Commenting out each of the four `touch` calls (rpc.ts:247, 255, 284, 298) in a temporary copy failed no SQLite guild test |
| D3 | open | R1-3 | Commenting out members.ts:61 in a temporary copy failed no SQLite guild test |
| D4 | open | R1-4 | Changing rpc.ts:294 to `PERMISSION` in a temporary copy failed no SQLite guild test |
| D5 | open | R1-5 | Changing the check at rpc.ts:85 to `me === null \|\| guild === null` in a temporary copy failed no SQLite guild test |
| D6 | open | R1-6 | Removing `join_value` from the `UPDATE` at tables.ts:229 in a temporary copy failed no SQLite guild test |

## must fix

none

## unknown

- The commit range is empty (f8dcbc5..f8dcbc5), so the review covered the six `## debt` items; the rest of the module was not reviewed again for problems outside the range.
- The defect restorations ran on SQLite only (`OGW_DEFAULT_DB` sqlite). No PostgreSQL was available, so the 9 PostgreSQL-only guild tests failed on both the unchanged and the changed copies and were not judged. None of them checks `active_at`, `join_value`, the `SetGuildMemberRole` target check, the join request deletion of `insert_new_guild`, or a member row that moved to another guild in `find_my_guild`.
- The temporary copy used `server/build/data` copied from the `open-game-works-core-impl/` main checkout (another commit), because this checkout has no built data.
