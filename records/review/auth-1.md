# review auth round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/auth/login.ts:112 | This range changed `claim_key` so that a `WITHDRAWN` `run_user_transaction` of the new user (`Login` step 3 with a social provider, and `DevLogin` of a new name, via `server/core/auth/dev/index.ts:34`) returns `UNAUTHORIZED` instead of the earlier `INTERNAL`. auth.md `## error` row "`run_request_transaction` or `run_user_transaction` of `Login`, `AutoLogin`, `RefreshToken`, `DevLogin`, or the ban login transaction, is `WITHDRAWN`" → `UNAUTHORIZED`, no log sets this behavior. No test goes through this branch: `tests/transaction-failure.test.ts:241` covers only the ban login transaction (`hold_next_transaction` holds `run_request_transaction`, `tests/helpers.ts:300`), `tests/token.test.ts:95` covers `AutoLogin`/`RefreshToken` after `Logout`, and no test holds or withdraws the new user between `create_user` and the `run_user_transaction` of `claim_key`. Restoring the earlier `return null` → `INTERNAL` at line 112 fails no test. Run path: `Login` provider `GOOGLE` of an unlinked account; after the `storage.create_user` game transaction commits, `withdraw_user` of the new user ID commits before `claim_key` opens its user transaction | Add a test that withdraws the new user (e.g. by holding `run_user_transaction` of the new user, as `hold_next_transaction` does for `run_request_transaction`) and asserts `UNAUTHORIZED` and no `error` log for `Login` with a social provider and for `DevLogin` of a new name | no | 82 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The tests were read, not run: `server/node_modules` is not installed in this checkout, so whether `server/core/auth/tests/transaction-failure.test.ts` and the other auth tests pass on this commit was not checked
- Whether a lock failure thrown from `storage.create_user`, `session.start_session` or a query of a transaction DB handle (the arming of `fail_next_call` and `fail_next_query`, `server/core/auth/tests/transaction-failure.test.ts:55`, `:75`) makes `storage` answer `FAILED` was read only at `server/core/storage/tx.ts:163`, `:184` and `server/core/storage/core.ts:220`; the `storage` behavior itself is another review target and was not reviewed
- The PostgreSQL path of the changed transactions was not run; only the code was read
- Client `AuthCore` test changes in the range (`client/godot/core/auth_core/tests/`) are not part of server module `auth` and were not reviewed. The other client, settings and `testing` changes in the range (`QACore`, `UnitTestCore`, `TweenCore`, `ScreenEffectCore`, `UICore`) do not reach `auth` and were not reviewed
