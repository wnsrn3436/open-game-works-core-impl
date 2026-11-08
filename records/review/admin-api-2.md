# review admin-api round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/admin-api/tests/auth.test.ts:26 now has `['revoke_login_tokens', 'ops']` in the `auth` row of `COLLECTED`, so `check_collected` (auth.test.ts:392) sends it as an `ops` holder (it must reach the auth handler), with a wrong secret (401) and as an operator without `ops` (403). Run on commit f87e031e: `ogw core test server admin-api --file server/core/admin-api/tests/auth.test.ts` passes. With the defect restored in a temporary `git worktree add` copy of f87e031e (role of `revoke_login_tokens` in server/core/auth/admin.ts:88 changed from `ops` to `read`), the same command fails in the sqlite and postgresql runs at `roles > lets each role call the admin operations of auth, 401 for a wrong secret, 403 without the role` with `expected [ 'revoke_login_tokens', true, false ] to deeply equal [ 'revoke_login_tokens', false, true ]` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The only admin-api change in the range is the test row of R1-1. The other server changes of the range were checked for their effect on admin-api by reading: the routing step 7 minimum app version judgement now made for `DevLogin` (server/core/routing/pipeline.ts:535, server/core/routing/dev/index.ts:167) does not touch the maintenance check that uses `admin-api.is_maintenance`, and no admin-api test publishes a deploy list with `min_version`; the SQLite open statements now metered as synchronous DB calls (server/core/storage/db/sqlite.ts:251) are not read by admin-api; the core settings default `item-ledger.historyRetentionMs` back to 90 days (commit a7045f49, cause and evidence in its message) changes no admin-api behavior, and no admin-api test moves the clock past 90 days before `list_item_history`. No problem was found
- Only `server/core/admin-api/tests/auth.test.ts` was run (admin-api, sqlite and postgresql); the whole admin-api suite and its dependents were not run, as no admin-api code changed in the range
- The two `## out of scope` items of round 1 (routing front body forwarding, matchmaker admin operations not exported) are in modules outside this target and unrelated to this range's changes, and were not checked again
