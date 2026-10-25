# review auth round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `server/core/auth/tests/transaction-failure.test.ts:260` `describe('a WITHDRAWN transaction of the new user')` holds the `run_user_transaction` of `claim_key` with `hold_next_user_transaction` (`server/core/auth/tests/helpers.ts:320`), withdraws the held user ID with admin `withdraw_user`, and asserts `UNAUTHORIZED` and no `error` log for `Login` provider `GOOGLE` of an unlinked account (`:273`) and for `DevLogin` of a new name (`:285`). Restored the defect in a temporary copy of the checkout outside the target (rsync without `.git`, server build data copied from `open-game-works-core-impl/server/build/data`): deleted line `server/core/auth/login.ts:112` (`if (result === 'WITHDRAWN') return failure(E.CORE_ERROR_UNAUTHORIZED, new_user);`), so a `WITHDRAWN` result goes to `transaction_failed` → `INTERNAL` with an `error` log. vitest of `server/core/auth/tests/transaction-failure.test.ts` on SQLite: both new tests failed (`expected 8 to be 9`), the other 11 passed. Without the restore, all 13 tests of that file passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only the SQLite run of `server/core/auth/tests/transaction-failure.test.ts` was done, in a temporary copy, with vitest of the ogw tools and server build data copied from `open-game-works-core-impl/server/build/data` (not built from this commit). The PostgreSQL run and the other auth test files were not run
- The changes to other modules in the range (`ScreenEffectCore` test, review and record files) do not reach `auth` and were not reviewed
