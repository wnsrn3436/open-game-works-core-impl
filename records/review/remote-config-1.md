## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/remote-config/index.ts:507 | `put_experiment` checks `salt` only for `''` (index.ts:450) and passes it as a raw `string` parameter to `UPSERT_EXPERIMENT`. In this range `server/core/storage/db/sqlite.ts:49` started to throw `DbError('sql', '22021')` for a string parameter holding U+0000, as PostgreSQL already did (`storage` spec: a statement with such a parameter fails in both DBs). Run: LOCAL test server (SQLite), `put_experiment` with `experiment_id` `[exp_a]`, `key_ids` `[[rc_count]]`, two groups and `salt` `"a\u0000b"` answers `internal` (500); the same call with `salt` `"ab"` answers `{experiment_id}`. The remote-config spec (`## API`: `salt` is "a non-empty string", rule violations are `bad_request`) makes that salt valid, so neither success nor `bad_request` (the only input failure it defines) is what happens. Group `name` and `values` are stored inside `JSON.stringify` and are not affected | Define in the remote-config spec that a `salt` holding U+0000 is `bad_request` (or have `admin-api` refuse U+0000 in every `string` field), then reject it in `experiment_groups` before any write, with a test | yes | 90 |

## previous

none

## out of scope

- server/core/admin-api/tables.ts:118: medium `write_operation` writes `operation_id` as a raw `string` parameter, and the admin-api body rules (`admin-api` spec: a `string` value is at most `admin-api.maxStringBytes`, `operation_id` is not empty) let U+0000 through, so every operation with `operation_id` whose handler succeeds answers 500 `internal` for an `operation_id` holding U+0000 on both DBs (on SQLite since `server/core/storage/db/sqlite.ts:49` of this range), which the admin-api spec does not define

## debt

none

## must fix

none

## unknown

- The module code of `server/core/remote-config/` is unchanged in the range; the review covered how the range's changes of `storage` (tx.ts body/savepoint/lock on a broken transaction, sqlite.ts U+0000 parameters, PostgreSQL `statement_timeout`, read connection retry), `admin-api` (JSON parser, `plain_json` refusing fractions, lock failure logging, switch cache at start), `logging` and `routing` reach the calls remote-config makes (`lock_game_row`, `db`, `read_db`, `after_commit`, admin handler results, `json` field values)
- The remote-config core tests were run on SQLite only (38 passed); the PostgreSQL run was not done because no PostgreSQL test instance was set up in this review
- The client module `RemoteConfigCore` (its test `test_values.gd` changed in the range) is not part of this server module target and was not reviewed
