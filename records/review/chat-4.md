# review chat round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | server/core/chat/index.ts:487 now returns `'CHANGED'` when a re-read `Direct` channel row has a key not in `locked`, and the `ChatModule.remove_user` type (index.ts:52) and the `remove_user` signature (index.ts:473) are `null \| 'FAILED' \| 'CHANGED'`, as chat.md:80, :206 and :259 set. The lock wait path still returns `'FAILED'` (index.ts:484, chat.md:258). Test server/core/chat/tests/lock.test.ts `makes remove_user CHANGED and change nothing ...` calls `h.chat().remove_user` in a `RunCoreTest` while another PostgreSQL transaction commits a `Direct` row of the leaving user with a stranger, and asserts `{ code: 0, value: 'CHANGED' }` (a `'FAILED'` return would give `value: 'FAILED'` and fail it), plus no change of `withdrawn_at`, messages and channel rows. The second test asserts `Withdraw` `INTERNAL` and one `error` line `withdrawal rolled back: a remove_user is CHANGED` with that user and `core/Withdraw` (auth.md:352), written by server/core/auth/account.ts:78. `ogw core test server chat --file server/core/chat/tests/lock.test.ts` passed in this checkout |

## out of scope

- server/core/guild/members.ts:184: medium guild.md:223 sets that `guild.remove_user` changes nothing and returns `CHANGED` when the re-read member row of the user exists and the guild row was not locked in step 1 or its guild is not the guild locked in step 1, but the code returns `LOCK_FAILED` (`'FAILED'`) there, and the `remove_user` type at server/core/guild/index.ts:82 allows only `LockFailed \| null`. Run path: a `Withdraw` whose member row another transaction creates or moves (e.g. a guild accepting that user's join request) between the first `db.member` read (members.ts:178) and the lock gives `FAILED` without a storage abort, so auth returns `INTERNAL` from the handler (server/core/auth/account.ts:79) with neither the `CHANGED` `error` log of auth.md:352 nor the routing step 13 `error` log of a `FAILED` request transaction. members.ts:189 (`guild === null` after the lock) also returns `FAILED` for a case that is not a lock wait

## debt

none

## must fix

none

## unknown

- Code changes of chat in the commit range are only the R3-1 fix (server/core/chat/index.ts:52, :473, :487) and server/core/chat/tests/lock.test.ts. The auth callers changed with it (server/core/auth/withdraw.ts, account.ts, admin.ts, deletion.ts, guest_sweep.ts, deps.ts) were read for how they use the chat `CHANGED` value: every one stops and rolls back on `FAILED` or `CHANGED`. The `CHANGED` paths of `ConfirmAge`, `withdraw_user`, `POST /account/deletion` and `auth_guest_sweep` have no test of their own; auth is another review target
- Spec changes checked against chat code: storage U+0000 rule (a `Text` passes `validation.check_text`, which rejects C0 controls per validation.md:89; a `RoomInvite` text has only `matchmaker.roomCodeAlphabet` characters; a `post_system_message` `text` with U+0000 makes the insert throw and the request `INTERNAL`, which chat.md does not set either way, and chat does not catch it); the storage rule that any other statement failure aborts the transaction (chat has no `try`/`catch` around storage calls in server/core/chat/*.ts); `read_db` (chat does not use it); `get_states` caller now `mission` (chat does not call it); the shortened `lock_game_row` key text (chat locks `chat_channel` only through `T.channel_lock_key`, as round 3 checked); the logging `log` level row removal (chat writes only `info` and `error` with `logging.write`, server/core/chat/index.ts:112). No chat code differs from these changed definitions
- Whether storage itself makes a U+0000 `string` parameter fail on SQLite, and the storage abort changes in server/core/storage/tx.ts, were not reviewed: storage is another review target
- Only server/core/chat/tests/lock.test.ts was run; the other chat test files did not change in the range and were not run. The R3-1 defect was not restored in a temporary copy (R3-1 is a `spec` finding, not `test evidence`); the assert on `value: 'CHANGED'` was judged by reading
