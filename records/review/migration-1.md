# review migration round 1

## findings

none

## previous

none

## out of scope

- server/core/migration/index.ts:242: medium `value.encode()` runs outside the `FAILED` handling of `convert`, so a converter that returns the same kind message with a field that cannot be encoded makes `convert_item` throw instead of giving `FAILED`. Run path: a converter sets an `int64` field to the number `1` and returns the item; `BigInt.asUintN(64, value)` at server/generated/contract/wire.ts:135 throws `TypeError: Cannot convert 1 to a BigInt` (checked on a generated class, `CoreContract.NicknameUserState`, and through migration with the test kind `QuestUserState`). Result in a temporary copy: `migrate_snapshot` throws out of `records.map` at server/core/migration/dev/index.ts:38 and returns no per record result, while `## DEV` of the migration spec says a record whose result cannot be encoded is `FAILED`. On a request read the same throw reaches the handler with 0 `item conversion failed` log lines, so the `fields` that `### convert_item` requires are missing. Unrelated to the commit range: server/core/migration/ has no change in it. A batch still counts that user as failed, through the catch at server/core/migration/index.ts:368
- server/core/migration/index.ts:150: medium `test evidence` no test goes through the `migration.maxRecordedFailures` limit of `failed_users` in `### batch`. Removing `if (out.length >= max) break;` in a temporary copy leaves every migration test passing (49 tests on SQLite, 48 passed and 1 skipped on PostgreSQL). A probe with the limit 1 and 3 failed users on the unchanged code gave one user ID and `failed_count` 3, so the behavior is right and only the test is missing
- server/core/migration/index.ts:374: medium `test evidence` no test goes through `WITHDRAWN` of `run_user_transaction` in a step, which `### batch` says counts nothing. Changing `else if (result !== 'WITHDRAWN')` to `else` in a temporary copy, which counts a withdrawn user as failed, leaves every migration test passing (same counts as above)
- server/core/migration/index.ts:223: medium `test evidence` no test goes through the decode failure that `### convert_item` makes `FAILED`. Changing that branch to return the stored bytes in a temporary copy leaves every migration test passing (same counts as above). A probe with bytes `ff ff ff` at a lower version on the unchanged code gave a throw, an `item conversion failed` log and an unchanged row, so the behavior is right and only the test is missing
- server/core/migration/index.ts:118: medium `test evidence` no test checks the `lease_owner` condition of the `DONE` write, which `### batch` says makes a step that lost its lease not change to `DONE`. Replacing `lease_owner = $3` with `$3 = $3` in a temporary copy leaves every migration test passing (same counts as above). The existing `DONE` write tests cover only the `status` condition, through `stop_migration_batch`
- server/core/storage/rows.ts:116: medium `efficiency` the `scan_users` query of a batch step grows with the number of users above `cursor_user_id` that have no lower version row. `WHERE u.user_id > $1 ... EXISTS (... s.contract_version < $3) ... LIMIT $2` stops early only after finding `migration.batchSize` matches, and `user_state` and `server_state` have only the key `(user_id, kind, item_id)` (server/core/storage/schema.ts:212), so each visited user costs two scans of that user's rows. The step that finds no user, which every batch must run to become `DONE`, visits every remaining `user` row. The query runs on `read_db` from job `migration_batch` (server/core/migration/index.ts:358), and storage.md `### DB adapter` says query functions are synchronous and that an answer later than `storage.dbAnswerWaitMs` closes the connection and is a DB connection failure. The duration was not measured

## debt

none

## must fix

none

## unknown

- The commit range has no change in server/core/migration/, server/core/storage/, server/core/server-time/ or server/core/logging/. The changes read for an effect on migration are server/core/Dockerfile, server/core/routing/tests/server-image.test.ts (only searched for references to migration), server/core/routing/tests/storage-sweep.test.ts, server/core/testing/dev/setting_types.ts, settings/ and the core-spec/ changes of user-snapshot-clone, routing, ranking and validation. No effect was found. The other changes in the range (client, tools, coupon, matchmaker) were not read
- `## out of scope` covers a read of all migration code and tests, not of the storage, server-time and logging implementations. Of those, only the parts migration calls were read: `scan_users`, `upgrade_user_rows`, the converter calls in server/core/storage/state.ts and server/core/storage/delta.ts by their call lines, and the field rules of logging
- The specs linked from the migration spec, the backward compatibility of `contract` and of `build`, were not read, so the contract version rules and the rollback constraint were not compared with the code. Of skills/core/command.md, lines 1 to 100 were read; `## review and code check` and the later sections were not. Of server-time.md, `## API`, the scheduler section and its `## error` and `## test` lines on `schedule_job` were read
- The temporary copy ran the vitest of the harness directly with the `ogw core test` inputs, once on SQLite and once on a throwaway PostgreSQL 18.6 container. `ogw core test server migration` on this checkout passed. The mutants show that the migration tests do not fail; the core tests of other modules were not run on them
- Whether the efficiency item matters at a given number of users was not measured, and no test with a large user table was run
