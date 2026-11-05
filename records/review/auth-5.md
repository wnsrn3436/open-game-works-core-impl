# review auth round 5

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D3 | fixed | none | `FallibleRemoveUser.remove_user` is now typed `'FAILED' \| 'CHANGED' \| null \| undefined` (server/core/auth/deps.ts:190), and `withdraw` returns at the first `remove_user` that is `'FAILED'` or `'CHANGED'`, before `logging.request_analytics_deletion`, `storage.delete_user` and the Apple revoke (server/core/auth/withdraw.ts:20). This follows auth.md:175 and the `CHANGED` row at auth.md:352. Every caller treats anything other than `'done'` as a failure: `Withdraw`/`ConfirmAge` return `INTERNAL` and write the `error` log `withdrawal rolled back: a remove_user is CHANGED` (server/core/auth/account.ts:76-79), `withdraw_user` returns `internal` (server/core/auth/admin.ts:31), web deletion returns `INTERNAL` (server/core/auth/deletion.ts:206), and the guest sweep keeps the guest (server/core/auth/guest_sweep.ts:24). `friend`, `chat` and `guild` now return `CHANGED` (server/core/friend/index.ts:400, server/core/chat/index.ts:487, server/core/guild/members.ts:186). Round 4 (R3-1, R3-2) checked the tests server/core/auth/tests/withdraw.test.ts:252 and :266 against restored defects |

## must fix

none

## unknown

- The commit range `2b98bb1..2b98bb1` is empty, so no code was changed in this round. Only the code at the D3 position and its callers in server/core/auth/ were read. The round 4 review file has no `## findings` rows and no `open` rows in `## previous`, so `## previous` is `none`.
- No tests were run this round. D3 is judged fixed from reading the code. Round 4 already tested the `CHANGED` path by restoring defects (records/review/auth-4.md, R3-1 and R3-2), and that code has not changed since.
- No auth test makes `chat.remove_user` or `guild.remove_user` give `CHANGED`. `withdraw` handles a `CHANGED` from any module on one path (server/core/auth/withdraw.ts:20), and the `friend` `CHANGED` tests cover that path.
