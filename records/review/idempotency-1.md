# review: idempotency round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/idempotency/index.ts:202 | Input debt D1, still present (the line moved from 204 to 202). `### request ID` of the idempotency spec says `save_withdrawn_response` does not save a response whose `ResponseEnvelope` has `error`, but no test covers it. The only error-response test (`server/core/idempotency/tests/request-id.test.ts:113`, handler `failing`) does not delete the user, so `save_withdrawn_response` returns early because `user_deleted` is `false`. The only calls that reach it with `user_deleted` `true` (`withdrawn.test.ts:18`, `:24`, `:33`, `:65`) use handler `withdraw` (`tests/helpers.ts:128`), which always returns a success body. `server/core/routing/pipeline.ts:727` calls it only after a success envelope, so routing tests do not reach that branch either. Run: in a `git worktree add` copy at 625ae189 I changed line 202 to `if (!ctx.user_deleted) return;` and ran `ogw core test server idempotency`. Both runs (SQLite and PostgreSQL) gave `idempotency pass`. The unchanged copy also passed | Add a test that runs a request transaction which calls `storage.delete_user` and then calls `save_withdrawn_response` with a `ResponseEnvelope` whose `error` is set. Assert that `idempotency_withdrawn_response` has no row for that token hash and request ID, and that a resend with the same access token and request ID calls the handler again. Example: a `send` handler that deletes the user and returns an error code, with `send` committing that error as `tests/helpers.ts:182` already does | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | The branch at `server/core/idempotency/index.ts:202` is still untested. Removing `\|\| !is_success(response)` still leaves `ogw core test server idempotency` passing on SQLite and PostgreSQL (see R1-1) |

## must fix

none

## unknown

- The commit range 625ae189..625ae189 is empty, so no changed code was reviewed. The review covered D1 and a read-through of `server/core/idempotency/index.ts` and its tests against the spec.
- The first run of the mutated copy failed once in `server/core/idempotency/tests/start.test.ts:14` on the PostgreSQL run, with `storage: cannot connect to PostgreSQL`. The mutation cannot reach that test, which never calls a save operation. The re-run passed and the unchanged copy passed, so the cause was not reproduced. It was not written as a finding.
- I did not run the core tests of the modules that depend on idempotency (`routing` and others).
