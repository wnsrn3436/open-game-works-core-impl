# review guild round 6

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R6-1 | spec | medium | server/core/guild/rpc.ts:186 | The storage spec change "A statement with a `string` parameter that holds U+0000 fails in both DBs" (storage.md `### DB adapter`) is implemented in this range by server/core/storage/db/sqlite.ts:49, which throws `DbError` 22021 for such a parameter. `SearchGuilds` passes the normalized client `name` straight to the query: rpc.ts:184 `normalize_text(request.name)` keeps U+0000 (validation.md normalization removes only `White_Space` and `Default_Ignorable_Code_Point`), the `(ogw.v)` of `SearchGuildsRequest.name` checks only `max_chars_key`, and server/core/guild/tables.ts:186 binds the prefix as `$1`. Reproduced on a scratch copy with a SQLite test server: one user creates guild `Alpha`, then `SearchGuilds` with `name` `a` U+0000 gives `CORE_ERROR_INTERNAL` and an `error` log `unhandled exception`; with the sqlite.ts:49 line removed it gives code 0 and an empty list. The guild spec gives `SearchGuilds` only the failure value `INVALID_REQUEST` (guild.md `## API`) and says it returns the guilds whose `normalized_name` starts with the normalized `name` (guild.md `### query`); no guild name holds U+0000 because `check_text` and `is_plain_text` reject C0 controls (validation.md plain text conditions), so the result the spec gives is an empty list. Any client can also fill the `error` log with such requests | In `SearchGuilds`, return the empty response without querying when the normalized `name` holds U+0000 (or is not plain text, since no saved name can then match), and add a test on SQLite and PostgreSQL that `SearchGuilds` with a `name` holding U+0000 succeeds with an empty list and writes no `error` log | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R5-1 | fixed | server/core/guild/members.ts:184-186 returns `'CHANGED'` when the re-read member row exists and its guild ID differs from the guild locked in step 1 or that guild row does not exist, before deleting the join request and cooldown rows; `FAILED` is returned only from the lock (members.ts:183). server/core/guild/index.ts:82 types it `LockFailed \| 'CHANGED' \| null`. The caller already stops on it: server/core/auth/withdraw.ts:20 returns on `'FAILED'` or `'CHANGED'`, and server/core/auth/deps.ts:190 types it `'FAILED' \| 'CHANGED' \| null \| undefined`. New tests in server/core/guild/tests/locks.test.ts (`describe('remove_user of the module object')`) call `remove_user` directly and assert `'CHANGED'` for the added-row, moved-row and missing-guild-row cases and `'FAILED'` past the lock wait limit, and the two `Withdraw` tests now assert one auth `error` log `withdrawal rolled back: a remove_user is CHANGED`, which a `FAILED` result would not write |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only the guild core tests of the reproduction above were run (one scratch test file on SQLite, in a copy outside the checkout); the PostgreSQL run of the same request was not made. On PostgreSQL a U+0000 text parameter is rejected by the server with SQLSTATE 22021, so the result is expected to be the same `INTERNAL`, but it was not run.
- The other spec changes of the diff were checked against guild's code and found to give no finding: the removed cooldown sentences and the removed DEV cheat-offset test of guild.md (`guild_cooldown` still has no expiry column in server/core/guild/tables.ts and the cooldown is judged with `is_reached_strict` of the request time); the storage rule that any other statement failure aborts the transaction (guild has no `try`/`catch` around queries, and its name registration and cooldown and sequence writes use `ON CONFLICT`, tables.ts:256, :343, :356); the `read_db` changes (guild runs no statement on the `read_db` handle); `run_user_changes` and `get_states` (guild uses neither); and the `logging.log` level rule (guild writes only `info` and `error`, server/core/guild/core.ts:166). The other client strings that guild writes or queries (`CreateGuild` and `UpdateGuild` `name` and `description`, admin `rename_guild`, `set_guild_description`, `import_guild`) pass `check_text` or `is_plain_text` before any statement, which rejects U+0000.
- The whole guild test suite and the suites of dependent modules were not run in this round.
