# review: admin-api round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R4-1 | fixed | server/core/admin-api/body.ts:61 `string_of` now requires `is_clean_text` (server/core/admin-api/json.ts:149: no U+0000 and `isWellFormed()`). Every `string` field, JSON body and query string alike, goes through `string_of` (body.ts:117-118); `enum`, `int64` string and `big_amount` values are matched against fixed texts or integer patterns, so no other string reaches a handler unchecked. In a scratch copy of HEAD outside the checkout (SQLite), restoring the old check (`!raw.includes("\u0000")` in place of `is_clean_text(raw)` at body.ts:61) makes processing.test.ts:83 (`grant_items` `operation_id` `"\ud800"`) and rules.test.ts:102 fail; with the fix in place all 12 admin-api test files pass |
| R4-2 | fixed | server/core/admin-api/json.ts:159 makes `plain_json` return the invalid result for a string value that is not clean text, and json.ts:171 does the same for an object member name. Arrays and objects recurse (json.ts:165-171), so this covers a string at any depth of a `json` field. In the scratch copy, removing the string value check (json.ts:159) makes processing.test.ts:109 (`send_mail` `text_value` / `once_key` with `a\u0000b` and `\ud800`) and rules.test.ts:102 fail; removing only the member name check (`\|\| !is_clean_text(k)` at json.ts:171) makes rules.test.ts:102 fail |
| R4-3 | fixed | processing.test.ts:83 now also sends `operation_id` `"\ud800"` and expects 400 `bad_request`, one `audit` line and GOLD balance 0. rules.test.ts:102 covers unpaired surrogates in a `string` field and U+0000 or unpaired surrogates in a `json` field value, in nested arrays and in member names. processing.test.ts:109 covers `send_mail` end to end; its `not.toHaveProperty('mail_user_state')` can fail, because a sent mail shows up under that key (mail.test.ts:44). Each restored defect in the scratch copy: (a) body.ts:61 back to the U+0000-only check: processing.test.ts:83 and rules.test.ts:102 fail; (b) json.ts:159 removed: processing.test.ts:109 and rules.test.ts:102 fail; (c) member name check at json.ts:171 removed: rules.test.ts:102 fails; (d) `isWellFormed()` dropped from `is_clean_text` (json.ts:150): processing.test.ts:83, processing.test.ts:109 and rules.test.ts:102 fail |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The admin-api changes in the range are server/core/admin-api/body.ts, json.ts, tests/processing.test.ts and tests/rules.test.ts. The other code changes (matchmaker, nickname tests, routing `secret_reader` / `HOST_SECRET_DIR`, client/godot virtual_pad_core) are in other modules. admin-api does not refer to them except through routing's `read_secret` dependency, which behaves the same with the new `store_folder` argument. I did not review them beyond that
- I left out the round 4 out-of-scope rows (mailbox mail_input.ts:143 `once_key` with U+0000, SQLite adapter sqlite.ts:49 accepting an unpaired surrogate) because they are already in records/review-debt/mailbox.json and records/review-debt/storage.json, and the code at those positions has not changed
- The restore runs were made in a scratch copy of HEAD outside the checkout (`git archive` of server, fixtures, settings, test-data, core-spec, proto, plus `server/build/data` from the open-game-works-core-impl main checkout at 0aa77dc, the same commit). They used the ogw-pinned vitest 5.0.3 with `OGW_DEFAULT_DB=sqlite` only and ran only the admin-api test folder. I did not run them on PostgreSQL. The checks under test run at step 5, before any DB statement, so the result does not depend on the DB
