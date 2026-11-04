## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | `correctness` | medium | server/core/admin-api/index.ts:410 | Input D1. A `json` field with a number outside the double range passes the body rules and ends in 500 `internal`. `value_of` (server/core/admin-api/body.ts:127) returns `plain_json(raw)` without a check, `plain_json` (server/core/admin-api/json.ts:52) turns `1e999` into `Infinity`, and `canonical_json` (server/core/storage/canonical_json.ts:29) throws while `input_sha256` is computed, before the handler function runs. A run on a test server in a temporary copy: `send_mail` with `{"operation_id":"a","user_id":<id>,"mail":{"x":1e999}}` and `broadcast_mail` with `{"operation_id":"b","start_at":0,"mail":{"x":-1e999}}` both answered 500 `{"error":"internal"}` and left the `error` line `admin operation <name> threw`. The control `send_mail` with `{"x":1}` answered 400 `bad_request`. open-game-works-core/skills/server-core/modules/admin-api.md:256 sets a body violation and `INVALID_INPUT` of mail to 400. Saved state does not change | In the `json` case of `value_of`, return `INVALID` when the value holds a number that is not finite, so the request ends at step 5 with 400 `bad_request`. This also covers the `json` fields of collected operations. Add a test for both operations | no | 100 |
| R1-2 | `spec` | medium | server/core/admin-api/body.ts:172 | Input D2. `check_query` writes query keys into the plain object `raw`, so `raw['__proto__'] = 'x'` sets no own key and `check_object` does not see the field. A run of `check_query` in a temporary copy with fields `{user_id: int64}`: `user_id=1&__proto__=x` returned `{user_id: 1n}`, and `user_id=1&other=x` returned null. open-game-works-core/skills/server-core/modules/admin-api.md:171 makes an unknown field `bad_request`. The field is dropped, so the handler function does not get it | Make `raw` an object without a prototype (`Object.create(null)`), so that `__proto__` is an own key and is refused as an unknown field. Add a test through a binary body operation | no | 100 |
| R1-3 | `spec` | medium | server/core/admin-api/index.ts:414 | Input D3. A 500 `internal` caused by a failed storage operation leaves the `audit` line and no `error` line. Path 1: `lock_game_row` is `FAILED`, the work returns `ROLLBACK` with the initial `fail('internal')` in `box.reply`, and `run_transaction` returns it because the `error` line at server/core/admin-api/index.ts:433 is written only for status `FAILED`. Path 2: `get_user` and `export_personal_data` answer `fail('internal')` at server/core/admin-api/operations.ts:132 and :150 without a log line. Runs on a SQLite test server in a temporary copy, with `storage.userLockWaitMs` 50 and another connection holding `BEGIN IMMEDIATE`: `get_user` and `export_personal_data` each answered 500 and the count of `error` lines stayed 0, while `unban_user` under the same lock answered 500 and the count became 1. With `storage.lock_game_row` replaced by a function that returns `FAILED`, `grant_items` and `broadcast_mail` each answered 500, each had an `audit` line with status 500, and the count of `error` lines stayed 0. Both 500 rows at open-game-works-core/skills/server-core/modules/admin-api.md:264 and :265 have the `error` log, and open-game-works-core/skills/server-core/modules/storage.md:337 and :341 give these storage failures no log of their own | Write the `error` line on these paths with the operation name and target user: when `lock_game_row` is `FAILED` in `run_transaction`, and when `read_user` is `FAILED` in `get_user` and `export_personal_data`. Add a test for each path that checks the `error` line | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | Reproduced on the current code by a request to a test server: 500 for `1e999` and `-1e999` in `mail`, 400 for the control `{"x":1}` |
| D2 | open | R1-2 | Reproduced on the current code: `check_query` returned `{user_id: 1n}` for `user_id=1&__proto__=x` |
| D3 | open | R1-3 | Reproduced on the current code. `get_user` and `export_personal_data` under a held SQLite write lock, and `grant_items` and `broadcast_mail` with `lock_game_row` returning `FAILED`, answered 500 with no `error` line |
| D4 | fixed | none | settings/core-settings.schema.json:85 to :88 now gives `admin-api.switchCacheMs` the `minimum` 1, so value 0 no longer passes the schema. open-game-works-core/skills/server-core/modules/admin-api.md:286 now writes `1 or more`. The schema changed in commit a4ab109, an ancestor of HEAD |

## must fix

none

## unknown

- The commit range is empty and `## spec changes` is `none`, so no changed code exists to review. Only the positions of the input debt items and the code they call were read. The rest of the module was not checked in this round and is not reported as passed.
- The `lock_game_row` path of R1-3 was run with a replaced function, not with a real lock timeout or deadlock. PostgreSQL was not started in this review. All runs used SQLite.
- The reproductions ran in a temporary copy of the checkout outside the checkout, with server build data copied from `server/build/data` of `open-game-works-core-impl/`, because this checkout has no `server/build/data`. That data was not compared with a fresh build of this commit.
- The core tests of admin-api and of the modules that depend on it were not run. Only the scratch reproduction test ran, and its 4 tests passed; they recorded results and had no asserts.
- `records/review-debt/spec-admin-api.json` is not an input list of this review. Its D1 appears out of date now that open-game-works-core/skills/server-core/modules/admin-api.md:286 writes `1 or more`, but that list was not otherwise rechecked.
- Its D2 (switch cache state before the first read) was read but not reproduced. server/core/routing/server.ts:213 to :217 starts listening before `end_start` runs job `admin_switch_cache`, so `is_maintenance` can be `false` in that gap, but no request was run in it. It is not written in `## out of scope` because its confidence is below 80.
