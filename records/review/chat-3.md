# review chat round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | server/core/chat/index.ts:487 | The spec change made the step 3 result of `remove_user` `CHANGED` (chat.md:80, :206, :259: "When there is a row with a key not locked in step 2, changes nothing and returns `CHANGED`"), while a lock wait over the limit stays `FAILED` (chat.md:258). The code still returns `'FAILED'` at index.ts:487 when a re-read `Direct` channel row has a key not in `locked`, and the `ChatModule` type at index.ts:52 and the `remove_user` signature at index.ts:473 allow only `null \| 'FAILED'`. The two values are observable through the caller: auth.md:351 makes `FAILED` the request transaction `FAILED` with the `error` log of `routing`, and auth.md:352 makes `CHANGED` `INTERNAL` with its own `error` log. Run path: test server/core/chat/tests/lock.test.ts:136 (another transaction writes a `Direct` row of the leaving user with a stranger while `remove_user` waits on a step 2 lock) reaches index.ts:487 and gets `FAILED`; that test asserts only `Withdraw` `INTERNAL` and its name says `remove_user is FAILED`, so no test checks the `CHANGED` value | Return `'CHANGED'` at index.ts:487, widen the `remove_user` return type at index.ts:52 and :473 to `null \| 'FAILED' \| 'CHANGED'` and its doc comment, and make the lock.test.ts:136 case assert that `remove_user` gives `CHANGED` (e.g. by calling `remove_user` in a user transaction, or by the `error` log that auth writes for `CHANGED`) | no | 95 |

## previous

none: the round 2 review file has no finding and no open row

## out of scope

- server/core/auth/withdraw.ts:19: medium `withdraw` stops only on `remove_user(ctx) === 'FAILED'`, and `FallibleRemoveUser` at server/core/auth/deps.ts:190 types the result as `'FAILED' \| null \| undefined`. auth.md:175 and :352 require that `chat`, `friend` and `guild` `remove_user` giving `CHANGED` stop the later operations and end `Withdraw` and `ConfirmAge` with `INTERNAL` and an `error` log, and roll back. No module returns `CHANGED` yet, but once chat returns it as chat.md:206 sets (R3-1), `withdraw` would go on to `storage.delete_user` and commit the withdrawal while a `Direct` channel row of the user that `remove_user` did not lock remains

## debt

none

## must fix

none

## unknown

- `## previous` has no row because the round 2 review file has no finding and no `open` row; its `## findings` and `## out of scope` are `none`
- No chat code or chat test changed in the commit range (`git diff --stat` over server/core/chat is empty). The review covered the chat code that the round 3 spec changes reach: `remove_user` (chat.md `CHANGED`), `ReportChatMessage` evidence and `ref` against the new block-report U+0000 rule (block-report.md), the `lock_game_row` key types against the new storage advisory lock key rule (storage.md), and `get_public_profiles` use against the public-profile dedup change
- block-report U+0000 rule: chat passes `ref` `<ChatChannelKind element name>:<key_a>:<key_b>:<seq>` (no U+0000) and the `text` of a `Text` or `RoomInvite` message as evidence (server/core/chat/index.ts:370). A `Text` passed `validation.check_text`; a `RoomInvite` text has only `matchmaker.roomCodeAlphabet` characters; `System` messages are `INVALID_REQUEST` before `add_report`. Whether `validation.check_text` rejects U+0000 and whether `roomCodeAlphabet` can hold U+0000 was not checked in their modules; an `INVALID_INPUT` from `add_report` maps to `INVALID_REQUEST` (chat.md:149), so no wrong save follows either way
- storage lock key rule: every chat `lock_game_row` of `chat_channel` goes through `T.channel_lock_key` (server/core/chat/tables.ts:118), so the key value types are the same at every lock. The advisory lock itself is storage code and was not reviewed here
- R3-1 was found by reading; no test was run for it. The chat tests were not run in this round
- Whether `friend` and `guild` `remove_user` return `CHANGED` as their specs now set was not checked in full; they are other review targets
