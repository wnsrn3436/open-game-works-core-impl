# review friend round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | server/core/friend/index.ts:400 returns `'CHANGED'` when a link row read again in step 3 has an other user not in the step 2 lock set, and `'FAILED'` stays only for the `friend_count` lock wait at index.ts:394 (open-game-works-core/skills/server-core/modules/friend.md:128-131, :164-165). The result type is `null \| Failed \| 'CHANGED'` (index.ts:70). auth stops on it: `withdraw` returns `'CHANGED'` (server/core/auth/withdraw.ts:19-20), and `Withdraw`/`ConfirmAge` give `INTERNAL` with the `auth` `error` log (server/core/auth/account.ts:75-80, auth.md:352). New tests server/core/friend/tests/block-withdraw.test.ts:187 (direct `remove_user` gives `CHANGED`, no row deleted, no count changed), :210 (lock wait gives `FAILED`, tables unchanged) and :228 (`Withdraw` `INTERNAL`, the only new `error` line is `withdrawal rolled back: a remove_user is CHANGED` with `request` `core/Withdraw`). Restored the defect in a temporary git worktree of HEAD outside this checkout (index.ts:400 `return 'CHANGED'` → `return 'FAILED'`) and ran `ogw core test server friend --file server/core/friend/tests/block-withdraw.test.ts`: the tests at :187 (`expected 'FAILED' to be 'CHANGED'`) and :228 (`expected [] to deeply equal [ [ …(2) ] ]`) failed on both the SQLite and PostgreSQL runs. On this checkout `ogw core test server friend` passes |

## out of scope

none

## debt

none

## must fix

none

## unknown

- In the range, friend changes only server/core/friend/index.ts:70 and :400 and server/core/friend/tests/block-withdraw.test.ts. Of the modules friend depends on, only server/core/logging/log_line.ts changes outside tests, and friend writes no log. The auth callers of `withdraw` (server/core/auth/account.ts, admin.ts:31, deletion.ts:206, guest_sweep.ts:24) were checked only for how they handle a `CHANGED` `remove_user`. The rest of auth, chat and guild was not reviewed
- The step 3 condition is made in the tests with a spy on `storage.lock_game_row` inside the same transaction, not with a real concurrent commit on PostgreSQL. A real concurrent interleaving on PostgreSQL was not run
- The whole server test suite was not run. Only the friend module tests were run
