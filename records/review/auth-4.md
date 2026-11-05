# review auth round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | server/core/auth/tests/withdraw.test.ts:266 (describe `Withdraw while another transaction commits a friend link row (PostgreSQL)`) follows auth.md `## test`. It holds A's `friend_count` lock with `testing.hold_lock_key(own, testing.game_row_lock_id('friend_count', [a.user_id]))`, sends `Withdraw` of U (A's friend) from a peer process, waits with `testing.until_blocked_by`, commits the U–B link rows with `testing.hold_db` and `COMMIT`, then releases. It asserts `INTERNAL`, that the peer's `error` entries are exactly one `withdrawal rolled back: a remove_user is CHANGED` with U's user ID and `core/Withdraw`, and that `withdrawn_at` is null. Restored in a temporary copy of the checkout (two mutants, run with `ogw core test server auth --file server/core/auth/tests/withdraw.test.ts`): (a) the second-read check `if (links.some((link) => !lockset.has(link.other_id))) return 'CHANGED';` in server/core/friend/index.ts:400 replaced by `void lockset;`: this PostgreSQL test fails (`expected +0 to be 8`, `Withdraw` succeeds); (b) the `error_log` line of `CHANGED` in server/core/auth/account.ts:78 deleted: this test fails (`expected [] to deeply equal [ { …(3) } ]`). On the unchanged checkout the file passes on SQLite and PostgreSQL |
| R3-2 | fixed | server/core/auth/tests/withdraw.test.ts:252 (`a friend.remove_user CHANGED makes every withdrawal fail and roll back, and Withdraw and ConfirmAge leave the error log of auth`) uses `withdrawals_roll_back` (withdraw.test.ts:153) with the hold `link_before_lock` (withdraw.test.ts:233), which inserts a link row of the user with the other user in the same transaction before `friend.remove_user` locks the user's own `friend_count` row, so the real `remove_user` gives `CHANGED`. It checks `Withdraw` and `ConfirmAge` below the minimum age `INTERNAL`, `withdraw_user` 500, `POST /account/deletion` 500 with `[auth_deletion_retry]`, the guest sweep keeping the guest with only the `inactive guest deletion failed; the next scan tries again` `error` log and no audit, no `withdrawn_at`, unchanged UserState and social links, no `revoke`, and the two `auth` `CHANGED` `error` logs with `core/Withdraw` and `core/ConfirmAge`. Each defect was restored in its own temporary copy and the test failed on SQLite and PostgreSQL: server/core/auth/admin.ts:31 `=== 'done'` → `!== 'FAILED'` (`expected 200 to be 500`); server/core/auth/deletion.ts:206 `=== 'done'` → `!== 'FAILED'` (`expected 200 to be 500`); server/core/auth/guest_sweep.ts:24 `!== 'done'` → `=== 'FAILED'` (`expected [ [ 'audit', …(1) ] ] to deeply equal []`); server/core/auth/account.ts:78 `CHANGED` `error_log` deleted (`expected [] to deeply equal [ [ '<user id>', …(1) ], …(1) ]`) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The changes of the range outside `server/core/auth/` (guild `remove_user` giving `CHANGED` and its tests, guild `SearchGuilds`, storage `abort.test.ts`, client modules) were checked only where auth calls them. `guild.remove_user` now returns `CHANGED` (server/core/guild/members.ts:186), which matches the type at server/core/auth/deps.ts:190 and is stopped by server/core/auth/withdraw.ts:20. This resolves the round 3 out-of-scope item (guild D7). No auth test makes `guild.remove_user` give `CHANGED`; auth handles every `remove_user` `CHANGED` the same way, and the friend `CHANGED` tests above cover that path.
- Only `server/core/auth/tests/withdraw.test.ts` was run (unchanged checkout and the mutants), not the whole auth suite or the dependents. The fix report states that `ogw core test server auth matchmaker rating routing testing` passed.
- The peer `error` capture in server/core/auth/tests/peer.ts counts only entries written through the `write` member of the `logging` object, as the fix report says. The auth and routing `error` lines of the `Withdraw` path were read to go through `logging.write`, and mutant (b) of R3-1 shows that the capture sees the auth line.
