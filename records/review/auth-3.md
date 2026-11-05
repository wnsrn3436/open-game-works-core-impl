# review auth round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | server/core/auth/tests/withdraw.test.ts:160 | The `## test` item added by the spec changes (open-game-works-core/skills/server-core/modules/auth.md:476) sets a PostgreSQL run: `Withdraw` of U waits in `friend.remove_user` step 2 for A's `friend_count` row held with `testing.hold_lock_key`(`testing.game_row_lock_id`), a `testing.hold_db` inserts a U–B link row and runs `COMMIT`, and after the release `Withdraw` is `INTERNAL` with one `error` log from `auth` and no `withdrawn_at`. No core test does this: `grep -rn "hold_lock_key\|game_row_lock_id\|hold_game_row_lock" server/core/*/tests` finds no test that holds a `friend_count` row while a concurrent transaction commits a link row. The closest test, `Withdraw whose second read finds a link row ...` (server/core/friend/tests/block-withdraw.test.ts:228), mocks `storage.lock_game_row` (`insert_before_lock`, block-withdraw.test.ts:36-49) and inserts the rows inside the withdrawing transaction itself, so it never runs the real lock wait or the READ COMMITTED re-read of a row that another transaction committed. The PostgreSQL `CHANGED` test that does run a concurrent commit is for `chat` only (server/core/chat/tests/lock.test.ts:167) | Add a PostgreSQL core test that follows auth.md:476: hold A's `friend_count` lock with `hold_lock_key(game_row_lock_id(...))`, start `Withdraw` of U, use `hold_db` to insert and commit the U–B link row, release, then assert `INTERNAL`, exactly one new `error` log whose message is the `auth` `CHANGED` log, and `withdrawn_at` null | no | 82 |
| R3-2 | test evidence | medium | server/core/auth/account.ts:115 | The spec changes make every `FAILED` rule hold for `CHANGED` (auth.md:175) and add the `CHANGED` row for `Withdraw` and `ConfirmAge` under the minimum age (auth.md:352). The range changed four `CHANGED` paths: `ConfirmAge` (account.ts:115, error log with `request` `core/ConfirmAge`), `withdraw_user` (admin.ts:31, `=== 'FAILED'` → `=== 'done'`), `POST /account/deletion` (deletion.ts:206) and job `auth_guest_sweep` (guest_sweep.ts:24, `=== 'FAILED'` → `!== 'done'`). Only `Withdraw` with `CHANGED` has a test (friend block-withdraw.test.ts:228, chat lock.test.ts:167). `grep -rn CHANGED server/core/*/tests` finds no test of `ConfirmAge`, `withdraw_user`, `POST /account/deletion` or the guest sweep with a `CHANGED` `remove_user`. The `FAILED` test at server/core/auth/tests/withdraw.test.ts:160-175 covers all four for `FAILED` only. Restoring the old `=== 'FAILED'` checks in admin.ts:31, deletion.ts:206 and guest_sweep.ts:24 makes a `CHANGED` withdrawal go on to commit as a success (200 `{}`, the done page, an audit `inactive guest withdrawn`) without the user rows deleted by the module that gave `CHANGED`, and no test fails | Add tests that make a `remove_user` give `CHANGED` (e.g. with the friend `insert_before_lock` pattern or the chat PostgreSQL `with_unlocked_direct_row` pattern) for `ConfirmAge` below the minimum age (`INTERNAL`, one `auth` `error` log with `request` `core/ConfirmAge`, no `withdrawn_at`, consent state unchanged), `withdraw_user` (500 `internal`), `POST /account/deletion` (500 and `[auth_deletion_retry]`) and `auth_guest_sweep` (guest not deleted) | no | 85 |

## previous

none — round 2 had no findings

## out of scope

- server/core/guild/members.ts:184: medium `guild.remove_user` returns `FAILED` (`LOCK_FAILED`) where guild.md:223 sets `CHANGED` (re-read member row of a guild that was not locked), and the type at server/core/guild/index.ts:82 does not allow `CHANGED`. Through auth, `Withdraw`/`ConfirmAge` then return `INTERNAL` from the handler with no storage abort, so neither the `auth` `CHANGED` `error` log of auth.md:352 nor the routing step 13 log of a `FAILED` request transaction is written. Already recorded as D7 of records/review-debt/guild.json

## debt

none

## must fix

none

## unknown

- The tests were not run: the worktree has no `server/node_modules`. The findings are from reading the code and tests and from `grep` over server/core.
- The round 2 finding R1-1 / debt D2 is not reconsidered, since round 2 marked it fixed and had no findings. D3 of records/review-debt/auth.json (`withdraw` not handling `CHANGED`) is not an input item. The range resolves it: server/core/auth/withdraw.ts:19-20 stops on `CHANGED`, and server/core/auth/deps.ts:190 allows it.
- Only the auth code changes (server/core/auth/) and the friend and chat `remove_user` changes that call into them were reviewed. The other modules changed in the range (admin-api, logging, mailbox, routing, storage, matchmaker, ranking, block-report, data tool) were checked only where auth calls them, and only for whether a handler that returns `INTERNAL` is rolled back (friend block-withdraw.test.ts:228 shows that the inserted rows are gone).
- The cause text `a remove_user is FAILED` in server/core/auth/deletion.ts:220 is also used for `CHANGED`. The spec does not set that message, so this is `low` and not written.
