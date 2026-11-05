# review: admin-api round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | server/core/admin-api/body.ts:60 | The spec change sets that a value of field type `string` holds no U+0000 (open-game-works-core/skills/server-core/modules/admin-api.md:178), so it breaks the body rules and is 400 `bad_request`. `string_of` checks only the type and `utf8_length(raw) <= limits.max_string_bytes`, and `name_rule` for `operation_id` (body.ts:77) checks only `value !== ''`. Repro with node on this checkout: `check_json_body({operation_id:string,user_id:int64,note:string}, parse_json(utf8('{"operation_id":"a\\u0000b","user_id":1,"note":"x\\u0000"}')), limits)` returned `{ operation_id: 'a\x00b', user_id: 1n, note: 'x\x00' }`, and `check_query({name:string}, new URLSearchParams('name=a%00b'), limits)` returned `{ name: 'a\x00b' }`. So a `grant_items` whose `operation_id` holds U+0000 passes step 5 and reaches `run_transaction` (server/core/admin-api/index.ts:419), where `lock_game_row` and `read_operation` pass `operation_id` as a DB text parameter; SQLite fails it at server/core/storage/db/sqlite.ts:49 and PostgreSQL with SQLSTATE 22021, so the answer is 500 `internal`, not 400. The same holds for every `string` field of every operation (JSON body and binary body query string) | In `string_of`, return `INVALID` when the value includes `'\u0000'`, so both `check_json_body` and `check_query` refuse it | no | 95 |
| R2-2 | spec | medium | server/core/admin-api/tests/processing.test.ts:69 | The changed `## test` item (open-game-works-core/skills/server-core/modules/admin-api.md:311) adds that a `grant_items` whose `operation_id` holds U+0000 is 400. No admin-api test sends U+0000: `grep` for `u0000`, `\0` and `x00` in server/core/admin-api/ finds nothing. The body rules test at processing.test.ts:69 covers the other items of that line only, and the unit tests in server/core/admin-api/tests/rules.test.ts have no U+0000 case | Add to the body rules test a `grant_items` request with `operation_id` `"a\u0000b"` that expects 400 `bad_request`, no balance change and one `audit` line; also a `rules.test.ts` case for a `string` field holding U+0000 in a JSON body and in a query string | no | 95 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range changed no file in server/core/admin-api/. I checked the spec change (U+0000 rule of the body rules and its `## test` item) against body.ts, json.ts, index.ts and the admin-api tests, and the changes of the range in storage (sqlite.ts `param`), mailbox (`mail_input.ts`) and item-ledger only where admin-api calls them
- I did not run the admin-api core tests through `ogw core test`; the repro of R2-1 ran `body.ts` and `json.ts` directly with node. That the request then ends in 500 rather than another status was checked by reading the code (index.ts:414-443, 478-486, storage/tx.ts:414, storage/db/sqlite.ts:47-50), not by running a server. This host has no `OGW_POSTGRESQL`, so the PostgreSQL path (SQLSTATE 22021) was not run
- Round 1 had no findings, so `## previous` has no rows
