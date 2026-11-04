# review migration round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/migration/index.ts:225 keeps in `applied` the from version of the last applied converter, and :244-248 encode the result inside a try and return `failed` with that from version on a throw, so `convert_logged` writes the `item conversion failed` log and `convert_item` / `migrate_record` give `FAILED`. Restored in a temporary copy outside the checkout by replacing the try at :244-248 with `return { kind: 'bytes', bytes: value.encode(), applied: true };`: convert.test.ts `a converter result that cannot be encoded is FAILED: ...` and snapshot.test.ts `a record whose converter result cannot be encoded is FAILED, ...` failed on SQLite; both pass on the unchanged copy |
| R1-2 | fixed | Restored in a temporary copy by removing `if (out.length >= max) break;` (server/core/migration/index.ts:150): batch.test.ts `failed_users keeps up to migration.maxRecordedFailures users, ...` failed on SQLite; it passes on the unchanged copy |
| R1-3 | fixed | Restored in a temporary copy by changing `else if (result !== 'WITHDRAWN') {` (server/core/migration/index.ts:380) to `else {`: batch.test.ts `a user the step picked who is withdrawn before its user transaction ...` failed on SQLite; it passes on the unchanged copy. The test checks that the step's `run_user_transaction` gave `WITHDRAWN` for that user, so it goes through that path |
| R1-4 | fixed | Restored in a temporary copy by making the decode failure branch (server/core/migration/index.ts:223) return `{ kind: 'bytes', bytes, applied: false }`: convert.test.ts `stored bytes that are not a message of the kind are FAILED: ...` failed on SQLite; it passes on the unchanged copy |
| R1-5 | fixed | Restored in a temporary copy by replacing `lease_owner = $3` of `MARK_DONE` (server/core/migration/index.ts:118) with `$3 = $3`: batch.test.ts `a step with no user to pick that loses its lease to another server instance before its DONE write leaves status RUNNING` failed on SQLite; it passes on the unchanged copy |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: the encode of the converter result is inside `convert` and a throw gives `FAILED` with the `item conversion failed` log (server/core/migration/index.ts:244-248); the request read and `migrate_snapshot` tests fail when the defect is restored |
| D2 | fixed | none | Same as R1-2: the new test fails when the `migration.maxRecordedFailures` limit check is removed |
| D3 | fixed | none | Same as R1-3: the new test fails when `WITHDRAWN` is counted as failed |
| D4 | fixed | none | Same as R1-4: the new test fails when the decode failure returns the stored bytes |
| D5 | fixed | none | Same as R1-5: the new test fails when the `lease_owner` condition of `MARK_DONE` is removed |

## must fix

none

## unknown

- All runs (the unchanged copy and the five restored defects) used SQLite only. The 5 PostgreSQL tests of `admin.test.ts` and `processes.test.ts` failed in every run, including the unchanged copy (50 passed, 5 failed of 55), because this environment had no `OGW_POSTGRESQL`. So the PostgreSQL runs of the new tests were not checked here; the core agent report states they pass and fail the same way on PostgreSQL.
- The runs used the server build data of `open-game-works-core-impl/server/build/data`, not data built from this checkout.
- The commit range also changes the modules guild, shop and ranking, test data and generated DEV data; those are outside this target and were not reviewed. Of the migration code, only the changes of the range and the code they call (`convert`, `convert_logged`, `convert_item`, `migrate_record`, `merge_failures`, `finish_step`, `step`) were read.
- In the R1-5 test, the lease of the other server instance is a direct `UPDATE` of the batch record made by the test, not a step of a second server instance (as the core agent report also states). It does reach the `MARK_DONE` condition, as the restored defect showed.
