# review guild round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/guild/tables.ts:63 now registers `guild_cooldown` with expiry column `null`, as guild `### tables` sets (expiry column `none`) and the cooldown rule says (a reached row stays until overwritten or `remove_user` deletes it). `sweep_expired` builds its targets only from tables whose expiry is not null (server/core/storage/rows.ts:391), so it no longer deletes cooldown rows by `clock_now`. The cooldown is judged only in server/core/guild/core.ts:179-181 by `is_reached_strict(ctx, ends_at)` on the raw row read (tables.ts:335-338), so the request time alone decides `GUILD_COOLDOWN`. The test item of the spec for DEV with a cheat time offset of −2 × `guild.rejoinCooldownMs` is server/core/guild/tests/join.test.ts:158: offset −2000 with `guild.rejoinCooldownMs` 1000, `LeaveGuild` writes `ends_at` START_AT − 1000 (before `clock_now`), `JoinGuild` is `GUILD_COOLDOWN`, `storage.sweep_expired()` runs, the row still exists and `JoinGuild` is still `GUILD_COOLDOWN`, and at offset −1000 (request time = `ends_at`) `JoinGuild` succeeds. With `'ends_at'` restored as the expiry column, the sweep condition `ends_at <= $1` (rows.ts:373) matches START_AT − 1000 ≤ START_AT, so `cooldown(kit, a.user_id)` at join.test.ts:168 would be null and the test fails (read from code; the core agent report also records this failure on SQLite and PostgreSQL) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same cause as R1-1: `guild_cooldown` has no expiry column (server/core/guild/tables.ts:63), so `sweep_expired` (server/core/storage/rows.ts:391) does not touch it and the storage `### expiry` rule no longer applies to that table; the cooldown is judged only with the request time (server/core/guild/core.ts:179-181), matching guild `### tables` |

## must fix

none

## unknown

- In the commit range the only guild changes are server/core/guild/tables.ts (expiry column of `guild_cooldown`), server/core/guild/tests/join.test.ts and server/core/guild/tests/kit.ts (`set_time_offset` via `core/cheat/SetTimeOffset`). No source file of its dependency modules (storage, server-time, logging, validation, public-profile) changed; core-spec/storage.json gained `get_states` and `get_user_records`, which guild does not call. The rest of the module was not reviewed again.
- No test was run in this round: this checkout has no `server/node_modules`. The fix and the new test were judged from the code; the core agent report states that `ogw core test server` for guild and its dependents passes and that the new test fails with the expiry column restored.
- The added assertions at server/core/guild/tests/join.test.ts:148-152 cover the `GetMyGuild` test item for a user who left with `LeaveGuild` (T + 1000 at T + 999, 0 at T + 1000, row still present at T + 1000), checked by reading.
