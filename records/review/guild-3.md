# review guild round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | open | Guild source is still unchanged in the range 9d75be3..944b49a (`git diff --stat` of `server/core/guild` and `server/core/storage` is empty). server/core/guild/tables.ts:63 still passes `'ends_at'` as the expiry column (5th argument of `storage.register_table`) of `guild_cooldown`, while guild `### tables` (skills/server-core/modules/guild.md:130 in the harness) sets its expiry column to `none` and guild.md:139 says a row whose `ends_at` the request time has reached stays until overwritten or `remove_user` deletes it. `sweep_expired` (server/core/storage/rows.ts:391) takes every registered table with a non-null expiry and deletes rows with `ends_at <= clock_now` (rows.ts:372-377). Run path, unchanged from round 1: DEV, `SetTimeOffset` −2 × `guild.rejoinCooldownMs`, `LeaveGuild` writes `ends_at` = request time + `guild.rejoinCooldownMs` (members.ts:131), which is before `clock_now`; `JoinGuild` is `GUILD_COOLDOWN` (rpc.ts:203, core.ts:179-181) until `storage_sweep` deletes the row, then succeeds at a request time still before `ends_at`. The test item at guild.md:360 (cooldown kept after the expiry cleanup of `storage` with a −2 × `guild.rejoinCooldownMs` offset) has no test: no guild test uses a time offset or runs the sweep (`grep -iE 'offset\|sweep\|expir' server/core/guild/tests/*.ts` finds nothing). Fix: pass `null` as the expiry column of `guild_cooldown` at tables.ts:63 and add the test of guild.md:360. Severity medium: it differs from the defining documents |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | The spec decision is made (guild.md:130 expiry column `none`, guild.md:139), but server/core/guild/tables.ts:63 still registers `ends_at` as the expiry column of `guild_cooldown`, so `sweep_expired` (server/core/storage/rows.ts:391) deletes those rows by `clock_now` |

## must fix

none

## unknown

- In the commit range no file of `server/core/guild` and no file of its dependency modules changed except server/core/public-profile/tests/profiles.test.ts (a test of another module). The review covered the parts of `## spec changes` that reach guild code: the `GetMyGuild` `cooldown_ends_at` wording and its new test item (guild.md:118, guild.md:139, guild.md:359), the `lock_game_row` failure and transaction-abort rule of storage (guild returns `INTERNAL` at once on every `LOCK_FAILED`, rpc.ts:82, 115, 130, 163, 198, 201, 224, and admin.ts returns `internal`), and the `public-profile` and `logging` changes (guild calls neither `get_user_records` nor the changed logging fields). The rest of the module was not reviewed again.
- server/core/guild/core.ts:179-181 returns `ends_at` while `is_reached_strict` is `false` and 0 otherwise, which matches guild.md:118 and guild.md:139. The test at server/core/guild/tests/join.test.ts:135 checks `cooldown_ends_at` T + 1000 at T + 999 and 0 at T + 1000 for a kicked user, not for a user who left with `LeaveGuild` as guild.md:359 names, and it does not assert that the `guild_cooldown` row still exists at T + 1000. Both paths write the row through the same `remove_member` (members.ts:127-131) and the row is not deleted at that point (the test clock does not run `storage_sweep` between the calls, read from code, not run), so this was not written as a finding.
- No test was run in this round: this checkout has no `server/node_modules` and no `server/build/data`. R1-1 / D1 was judged from the code, which is the same as in round 2, where the reproduction was described.
