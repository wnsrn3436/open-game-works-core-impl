# review migration round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | server/core/migration/index.ts:242 | Debt D1, still open. `value.encode()` runs after the converter loop, outside the paths of `convert` that give `failed`, so a converter that returns the same kind message with a field that cannot be encoded makes `convert` throw. Reproduced on HEAD in a temporary copy with a probe test: converter `QuestUserState:2` sets `progress` (`int64`) to the number `1` and returns the item. A request read of a version 2 `quest_user_state` row threw `TypeError: Cannot convert 1 to a BigInt` (from `BigInt.asUintN(64, value)` at server/generated/contract/wire.ts:135), with 0 `item conversion failed` log lines. `s.dev.migrate_snapshot` of a snapshot with that row threw the same `TypeError` out of `records.map` (server/core/migration/dev/index.ts:38) instead of returning that record as `FAILED`, which `## DEV` of the migration spec requires for a record whose result cannot be encoded | Encode inside `convert` in a try and return `{ kind: 'failed', from_version: <from version of the last applied converter>, reason: ... }` on a throw, so that `convert_logged` logs it and `migrate_record` and `convert_item` give `FAILED`; add a test with a converter that returns an unencodable field | no | 95 |
| R1-2 | test evidence | medium | server/core/migration/index.ts:150 | Debt D2, still open. No test goes through the `migration.maxRecordedFailures` limit of `failed_users` (`### batch`). In a temporary copy of HEAD, removing `if (out.length >= max) break;` leaves the migration tests at the same result as the unchanged code: 44 passed on SQLite (the 5 PostgreSQL tests could not run without `OGW_POSTGRESQL` in both runs) | Add a batch test whose `migration.maxRecordedFailures` is smaller than the number of failed users and check that `failed_users` has that many IDs, the smallest first, and that `failed_count` counts all of them | no | 95 |
| R1-3 | test evidence | medium | server/core/migration/index.ts:374 | Debt D3, still open. No test goes through `WITHDRAWN` of `run_user_transaction` in a step, which `### batch` says counts nothing. In a temporary copy of HEAD, changing `else if (result !== 'WITHDRAWN')` to `else` leaves the migration tests at 44 passed on SQLite, the same as the unchanged code | Add a batch test with a withdrawn user picked by the step (e.g. withdrawn after the scan) and check that `converted_users`, `failed_count` and `failed_users` do not count it | no | 90 |
| R1-4 | test evidence | medium | server/core/migration/index.ts:223 | Debt D4, still open. No test goes through the decode failure that `### convert_item` makes `FAILED`. In a temporary copy of HEAD, changing that branch to `return { kind: "bytes", bytes, applied: false }` leaves the migration tests at 44 passed on SQLite, the same as the unchanged code | Add a test that seeds bytes that are not a message of the kind (e.g. `ff ff ff`) at a lower contract version and checks `INTERNAL`, the unchanged row and the `item conversion failed` log with its `fields` | no | 95 |
| R1-5 | test evidence | medium | server/core/migration/index.ts:118 | Debt D5, still open. No test checks the `lease_owner` condition of the `DONE` write, which `### batch` says keeps a step that lost its lease from changing the batch to `DONE`. In a temporary copy of HEAD, replacing `lease_owner = $3` with `$3 = $3` in `MARK_DONE` leaves the migration tests at 44 passed on SQLite, the same as the unchanged code. The existing `DONE` write tests cover only the `status` condition, through `stop_migration_batch` | Add a test in which a step with no user to pick loses its lease to another server instance before its `DONE` write, and check that the `status` stays `RUNNING` | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | server/core/migration/ is unchanged since the item was written; a probe on HEAD reproduced the throw on a request read (0 `item conversion failed` logs) and through `migrate_snapshot` |
| D2 | open | R1-2 | Mutation removing the limit check leaves the migration tests passing (44 passed on SQLite, same as unchanged) |
| D3 | open | R1-3 | Mutation counting `WITHDRAWN` as failed leaves the migration tests passing (44 passed on SQLite, same as unchanged) |
| D4 | open | R1-4 | Mutation returning the stored bytes on a decode failure leaves the migration tests passing (44 passed on SQLite, same as unchanged) |
| D5 | open | R1-5 | Mutation removing the `lease_owner` condition of `MARK_DONE` leaves the migration tests passing (44 passed on SQLite, same as unchanged) |

## must fix

none

## unknown

- The commit range is empty (`9361609..9361609`) and `## spec changes` is `none`, so only the positions of the `## debt` items were reviewed; the rest of the migration code was not reviewed again in this round.
- The mutation and probe runs used SQLite only. The 5 PostgreSQL tests of `admin.test.ts` and `processes.test.ts` failed in every run, including the unchanged code, because this environment had no `OGW_POSTGRESQL`. So it was not checked whether a PostgreSQL test catches the D2 to D5 mutations; the original debt items report that they did not (48 passed and 1 skipped on PostgreSQL).
- The runs used the server build data of `open-game-works-core-impl/server/build/data`, not data built from this checkout.
