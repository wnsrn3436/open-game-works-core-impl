# chat review round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range 625ae189..aca0d897 changes no file under `server/core/chat/`. Of the modules chat depends on (`storage`, `server-time`, `logging`, `validation`, `nickname`, `public-profile`, `block-report`, optional `friend`, `guild`), only `storage` and `logging` change code, and `nickname` changes only a test. Input `## spec changes` is `none`. The review checked the changed code of the range that chat calls or runs under:
  - `storage` (`server/core/storage/core.ts`, `server/core/storage/tx.ts`, `server/core/storage/index.ts`): the new `fail_transaction` makes `user_state_of` and `any_state_of` throw a `DbError` on a marked transaction, and `body` ends that transaction as `FAILED`. Chat never calls `fail_transaction` (`server/core/chat/deps.ts:11` picks only `register_table`, `get_state`, `db`, `lock_game_row`, `check_hook_output`) and has no `try`/`catch` (`grep catch server/core/chat/*.ts` finds none). So when a hook (`validate_chat_send`, `on_chat_message_sent`) or a module it calls marks the transaction, the throw of chat's next storage call goes up to `body`, which returns `FAILED` whatever chat would have returned. That is the `storage` rule (`skills/server-core/modules/storage.md:149`), and chat turns no such throw into a value. `check_hook_output` (`server/core/storage/hook_output.ts:10`) reads no transaction state and is unchanged. `lock_game_row` of a chat channel on a transaction that is not marked behaves as before, so the `FAILED` that `lock_channel` (`server/core/chat/index.ts:186`) and `remove_user` (`server/core/chat/index.ts:483`) rely on is unchanged
  - `logging` (`server/core/logging/metrics.ts`): only the comment of `alerts` changes; the code chat reaches through `write` is unchanged
  - `session` (`server/core/session/index.ts`): `end_session` now deletes only the ctx session. Chat does not call `session`; `Withdraw` reaches chat only through `remove_user`, which this change does not touch
  - `item-ledger`, `iap`, `admin-api`, `idempotency`, `auth` (tests only): chat does not depend on these. The `admin-api` change is the `maxSearchRows` minimum, which the chat admin operations do not read
- Chat code and tests that the range does not reach were not reviewed again, as the commit range is not `none`
- `ogw core test server chat` on aca0d897 failed in both runs, under a host load average of about 23 to 32. Run 1 (job mw8k6myl07f679): 5 PostgreSQL-run tests failed (`child.test.ts`, `direct.test.ts`: `testing: wait_background did not end within 10000 ms`; `lock.test.ts`, `modules.test.ts`, `withdraw.test.ts`: `cannot connect to PostgreSQL: the connect to PostgreSQL went over its time limit`). Run 2 (job mw8knm2t39f914): 6 different tests failed (sqlite run `lock.test.ts`, `withdraw.test.ts`; postgresql run `direct.test.ts`, 2 in `guild.test.ts`, `send-rules.test.ts`), each with `Test timed out in 60000ms` or the same PostgreSQL connect time limit. No test failed in both runs. Every failure is a time limit or a connect time limit, and no assert on a chat result failed. The range changes no chat code. The cause (connect and wait time limits under host load) was not checked further: it is in the `storage` PostgreSQL connect, the `testing` waits and the test host, outside this target. So the chat tests on this commit are `unknown`, not `pass`. The tool wrote no test record because the checkout has the uncommitted deletion of `records/review/chat-1.md`
