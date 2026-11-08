# review: idempotency round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | New test `server/core/idempotency/tests/withdrawn.test.ts:62` uses handler `withdraw_failing` (`server/core/idempotency/tests/helpers.ts:137`). That handler calls `storage.delete_user` and answers `INVALID_REQUEST`, and `send` (`helpers.ts:193-194`) commits that error envelope through `save_withdrawn_response` with `user_deleted` `true`. The test asserts that `idempotency_withdrawn_response` has no row and that `find_withdrawn_response` returns none. To restore the defect I made a `git worktree add --detach` copy at 642001ec, changed `server/core/idempotency/index.ts:202` to `if (!ctx.user_deleted) return;`, and ran `ogw core test server idempotency --file server/core/idempotency/tests/withdrawn.test.ts`. That test failed on SQLite and on PostgreSQL with `AssertionError: expected [ { …(3) } ] to deeply equal []` (the row check at `withdrawn.test.ts:66`). With the line restored, `ogw core test server idempotency` gave `idempotency pass` on both DB runs |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | The `\|\| !is_success(response)` branch of `server/core/idempotency/index.ts:202` is now covered by `server/core/idempotency/tests/withdrawn.test.ts:62`. That test fails when the branch is removed (see R1-1 in `## previous`) |

## must fix

none

## unknown

- Most of the commit range 625ae189..642001ec is outside this target: review records, review-debt lists, the `admin-api` settings schema and `nickname` tests. I did not review those. Within idempotency, only `server/core/idempotency/tests/helpers.ts` and `server/core/idempotency/tests/withdrawn.test.ts` changed. There was no implementation change.
- I did not run the core tests of the modules that depend on idempotency. Only idempotency test files changed, and the core agent report says those dependents pass at 08f46b68.
