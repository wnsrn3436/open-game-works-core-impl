# review block-report round 1

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

- The commit range 625ae189..aca0d897 changes no file under `server/core/block-report/`. The block-report code (`server/core/block-report/index.ts`) and tests were read in full, and the changes of the range that block-report reaches were checked against them: `storage` (`server/core/storage/core.ts`, `tx.ts`, `index.ts`: the new `fail_transaction`, the `not_failed` check in `user_state_of` and `any_state_of`, and the `FAILED` end of a marked transaction in `body`). block-report does not call `fail_transaction` and catches no throw of a storage operation (`lock_game_row`, `db().query`, `get_user_records`), so on a transaction that another module marked, its operations throw and the transaction ends as `FAILED` as storage `## behavior` sets; no block-report result changes for an unmarked transaction. `logging` (`server/core/logging/metrics.ts`: only a comment changed), `session` (`end_session` deletes only the ctx session; block-report does not call it), `admin-api` (`operations.ts`: the `source` element name of `list_item_history`; `admin-api.maxSearchRows` minimum 1), `iap`, `item-ledger`, `auth` and `idempotency` changes do not reach a block-report code path. `server/core/validation/`, `server/core/public-profile/` and `server/core/server-time/` did not change in the range, and no `block-report.*` entry of `settings/core-settings.schema.json` changed.
- `ogw core test server block-report` was run three times on aca0d897 in this worktree, with a host load average of about 20 to 35. The first run failed 7 PostgreSQL tests (`admin.test.ts`, `block.test.ts` and `report.test.ts` first tests: `wait_background did not end within 10000 ms`; `block.test.ts` GetBlockedUsers, `report.test.ts` INVALID_REQUEST/USER_NOT_FOUND, `withdraw.test.ts` target-only export: `the schema lock: the connect to PostgreSQL went over its time limit`; `withdraw.test.ts` two-instance test without a withdrawal: `Test timed out in 60000ms`). The second run failed 3 PostgreSQL tests (the first tests of `admin.test.ts`, `block.test.ts` and `report.test.ts`: `Test timed out in 60000ms`). The third run passed every block-report test on SQLite and PostgreSQL. Every failure was a server start, PostgreSQL connect or test timeout, the failing set differed between runs, and none was an assert of a block-report result; their cause (host load or a timing dependence of these tests) was not checked, so they are not written as a finding.
- The `iap`, `item-ledger`, `session`, `admin-api` and client changes of the range were not reviewed beyond whether they reach block-report; they are outside this target.
