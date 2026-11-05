# review friend round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | server/core/friend/index.ts:399 | The spec change makes step 3 of `remove_user` return `CHANGED` when a link row read again has an other user not locked in step 2, keeping `FAILED` only for the lock wait (open-game-works-core/skills/server-core/modules/friend.md:67, :131, :164-165). The code still returns `'FAILED'` there (`if (links.some((link) => !lockset.has(link.other_id))) return 'FAILED';`), and the result type has no `CHANGED` (`export type Failed = 'FAILED'` at index.ts:57, `remove_user(ctx: RequestCtx): null \| Failed` at index.ts:70). Run path: server/core/friend/tests/block-withdraw.test.ts:167-193 writes the C→A pair between step 1 and step 3, so `remove_user` reaches index.ts:399 and gives `FAILED`. The difference is observable: open-game-works-core/skills/server-core/modules/auth.md:351-352 gives `FAILED` the `error` log of `routing` (step 13) and `CHANGED` an `INTERNAL` with the `error` log that `auth` leaves (auth.md:476). No friend test calls `remove_user` and checks which value it gives; that test checks only that `Withdraw` is `INTERNAL` | Return `'CHANGED'` at index.ts:399, add `CHANGED` to the `remove_user` result type, and add a test that drives `friend.remove_user` through the step 3 condition (e.g. the spy of block-withdraw.test.ts:174) and asserts `CHANGED` and unchanged tables, and one that asserts `FAILED` on the lock wait. auth must stop on `CHANGED` at the same time (see `## out of scope`), or `Withdraw` would go on after friend changed nothing | no | 95 |

## previous

none

## out of scope

- server/core/auth/withdraw.ts:19: medium `withdraw` stops only when a `remove_user` is `'FAILED'`, and `RemoveUserModule.remove_user` is typed `'FAILED' \| null \| undefined` (server/core/auth/deps.ts:190), so `CHANGED` of `chat`, `friend`, `guild` is not handled. open-game-works-core/skills/server-core/modules/auth.md:175 and :352 require a `CHANGED` `remove_user` to stop the later operations and end `Withdraw`/`ConfirmAge` with `INTERNAL`, rolled back, with an `error` log that `auth` leaves (auth.md:476). Once friend returns `CHANGED` as R3-1 requires, `Withdraw` would go on to `guild`, `block-report`, `request_analytics_deletion` and `storage.delete_user` while friend deleted nothing, leaving link rows and counts of the withdrawn user. No server core module returns `CHANGED` yet (`grep "CHANGED'" server/core` finds none)

## debt

none

## must fix

none

## unknown

- The commit range changes no file under `server/core/friend/`; inside the modules friend depends on it changes only server/core/block-report and server/core/public-profile tests and server/core/block-report/index.ts. The parts of the spec changes that reach friend were checked against the friend code: `get_public_profiles` now gives one entry per distinct user ID (friend passes distinct link other users at index.ts:359 and search results at index.ts:384), `lock_game_row` `FAILED` on a deadlock or serialization failure (handled at index.ts:254 and :395 as for a lock wait), and the `request` field of the `routing` `request` log line (friend writes no log). No other difference was found.
- No tests were run in this round: R3-1 is read from the code at index.ts:399 against the changed spec and needs no run, and there was no previous finding to recheck.
- The PostgreSQL behavior of the storage spec changes (advisory lock keys, `57014` abort, aborted transaction handling) is storage's implementation and was not reviewed here.
- auth, chat and guild were not reviewed beyond the `CHANGED` handling written in `## out of scope`.
