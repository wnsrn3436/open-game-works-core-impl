# review guild round 5

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R5-1 | spec | medium | server/core/guild/members.ts:184 | The spec change makes `remove_user` step 3 return `CHANGED` (guild `### withdrawal` step 3, `## API` failure values `FAILED`, `CHANGED`, and the new `## error` row "the `guild_member` row of that user that `remove_user` read again is not a row of the guild locked in 1 → `CHANGED`"). The code still returns `LOCK_FAILED` (`'FAILED'`) there: `if (me !== null && me.guild_id !== locked_guild) return LOCK_FAILED;`. The return type is still `LockFailed \| null` (server/core/guild/index.ts:82, members.ts:176) and the doc comment at members.ts:173-174 still says `FAILED`. Run path: server/core/guild/tests/withdraw.test.ts:169 (an accept adds the applicant's member row and commits after `remove_user` read no row and locked only that member row): the re-read row is in a guild that step 1 did not lock, so `remove_user` gives `FAILED`, not `CHANGED`. The test at withdraw.test.ts:179 and server/core/guild/tests/locks.test.ts:280 and :306 only check that `Withdraw` is `INTERNAL`, which both values give, so no test checks the value `remove_user` returns | Return `'CHANGED'` from members.ts:184, widen the type of `remove_user` in index.ts:82 to `'FAILED' \| 'CHANGED' \| null`, fix the comment, and add a test that calls `remove_user` directly in the step 3 case and expects `CHANGED`, and `FAILED` on a lock wait limit. The caller `auth` treats only `'FAILED'` as failure (see `## out of scope`), so that caller has to be changed together, or a `Withdraw` would go on after `CHANGED` | no | 95 |

## previous

none (round 4 had no findings and no `open` rows)

## out of scope

- server/core/auth/withdraw.ts:19: medium `withdraw` stops only on `remove_user(ctx) === 'FAILED'`, and `FallibleRemoveUser.remove_user` is typed `'FAILED' \| null \| undefined` (server/core/auth/deps.ts:190), while auth spec says every rule for `FAILED` also holds for `CHANGED` of `chat`, `friend`, `guild` and that `CHANGED` in `Withdraw` or `ConfirmAge` is `INTERNAL`, rolled back, with an `error` log by auth. Once guild returns `CHANGED` (R5-1), `withdraw` would go on to `storage.delete_user` and commit the withdrawal while the user's `guild_member` row, which guild did not change, remains

## debt

none

## must fix

none

## unknown

- Previous round (guild-4.md) had no findings and no `open` rows, so `## previous` has no rows to judge.
- No guild source or test file changed in the commit range; the review is of the guild code against the spec changes of the diff. Changes in that diff to `storage` (advisory lock key of `lock_game_row`, `read_db` throws, TypeScript shapes of `get_user_record` and `get_user_records`), `public-profile` (distinct user IDs in `get_public_profiles`) and `logging`/`server-core` (log `request` field) were checked against guild's uses: every `lock_game_row` call of guild passes `bigint` key values (server/core/guild/core.ts:110, :112, :130; rows converted to `bigint` in server/core/guild/tables.ts:101-133, admin input with `big`), guild does not run statements on the `read_db` handle, server/core/guild/admin.ts:233 uses `record === null` / `withdrawn_at` as the new shape gives, and `GetGuild` passes distinct member user IDs to `get_public_profiles` (server/core/guild/rpc.ts:107). No finding came from them.
- No test was run in this round: the change found is read from code; the observable `Withdraw` result is the same `INTERNAL` for both values, so a run would not separate them.
