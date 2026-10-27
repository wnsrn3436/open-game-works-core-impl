# review guild round 1

## findings

none

## previous

none

## out of scope

- server/core/guild/core.ts:179: medium The cooldown check uses the request time (`is_reached_strict(ctx, ends_at)`), but `sweep_expired` deletes `guild_cooldown` rows with `ends_at` ≤ `clock_now` (server/core/storage/rows.ts sweep_sql). storage `### expiry` says such a row "counts as a row that does not exist, also before it is deleted", while guild `### tables` cooldown says `GUILD_COOLDOWN` while `is_reached_strict(ends_at)` is `false`. Run path (DEV, cheat offset allowed down to −clock): user sets `SetTimeOffset` −25h, gets kicked or leaves (`remove_member` writes `ends_at` = request time + `guild.rejoinCooldownMs` 86400000, which is about 1h before `clock_now`). Until the next `storage_sweep` run, `JoinGuild`/`CreateGuild` return `GUILD_COOLDOWN`. After the sweep deletes the row, the same requests succeed even though the request time is still before `ends_at`. Without an offset, the same split happens in the window between the transaction's request time and the sweep's `clock_now`. This code was here before the range (guild source unchanged since 301b3dd). The two defining documents disagree, so the fix needs a spec decision: judge the cooldown with `clock_now`, or exclude this table from the storage rule

## debt

none

## must fix

none

## unknown

- In the range cf89b7fd..89fbbb02, no file under server/core/guild/ changed, and neither did public-profile, validation, logging or server-time. These changes in storage and routing reach guild, and I read each one against guild: `register_table` now adds the index `(ends_at)` to `guild_cooldown` (server/core/storage/schema.ts with_expiry_index), which matches storage `### table` and does not change guild results. `CREATE INDEX IF NOT EXISTS` is used. `sweep_expired` now deletes in batches by row address, and the outer expiry condition keeps a row that `set_cooldown` upserts after the inner select. Guild uses only one upsert statement for cooldown writes (server/core/guild/tables.ts:342). `NO_FREE_CONNECTION` is now `'POOL'` and is in `LOCK_CODES` (server/core/storage/db/postgres.ts). Before the range, `55P03` was already a lock code, so `lock_game_row` still returns `FAILED` here, and guild maps that to `INTERNAL`. No defect was found in these changes
- The guild tests were run with `ogw core test server guild` (job mvqlt64t6cb1a0), and both runs passed. They were run on the open-game-works-core-impl checkout (HEAD 172b8fa), not on this review worktree (89fbbb0). Between those two commits, nothing under server/core or settings differs
- I did not run a concurrent test of PostgreSQL `sweep_expired` against a guild `set_cooldown` upsert. Only the storage test for the upsert case covers it (server/core/storage/tests/expiry.test.ts), and that test was not run in this review
