# review fix: admin-api round 2

## done

- server module `admin-api`: `string_of` (server/core/admin-api/body.ts:60) refuses a value that holds U+0000, so every field of type `string` (also inside `array`, `object` and `object union`) breaks the body rules and is 400 `bad_request`, in a JSON body (`check_json_body`) and in the query string of a binary body operation (`check_query`)
- tests: server/core/admin-api/tests/rules.test.ts `refuses a string field holding U+0000 in a JSON body and in a query string`; server/core/admin-api/tests/processing.test.ts `answers 400 for grant_items whose operation_id holds U+0000, with no balance change and one audit line`
- no engine-specific implementation rules document written; `## <engine> build` of `tools/ogw.md` not written

## spec proposals

none

## review

- R2-1: fixed. server/core/admin-api/body.ts:60-62 (`!raw.includes('\u0000')` in `string_of`). Test: rules.test.ts `refuses a string field holding U+0000 in a JSON body and in a query string` (JSON body `operation_id` and `note`, a `string` inside an `object union`, query `name=a%00b`; U+0001 is still accepted). Without the fix, the processing test answered `[500, 'internal']` on both the SQLite and the PostgreSQL run, which reproduces the cause the review gave
- R2-2: fixed. processing.test.ts:83 (`grant_items` with `operation_id` `"a\u0000b"` expects 400 `bad_request`, one `audit` line and balance 0) and the rules.test.ts case above. Both failed with body.ts at HEAD and pass with the fix

## unverified

- Final `ogw core test server admin-api auth matchmaker notice rating routing testing` passed (SQLite and PostgreSQL). One run before it failed in `testing` at background.test.ts `makes restart_test_server throw and leaves no temporary folder, PostgreSQL database or port`: `start_test_server` itself went past the test's 1000 ms real-time `testing.backgroundWaitTimeoutMs` before the job was held, while all the modules were running together. It passed in the run before that and in the final run, and this change does not touch `testing`. The timing cause was judged from reading the test and was not reproduced in isolation
- `ogw code check core`: all pass
