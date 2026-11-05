# review: admin-api round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | server/core/admin-api/body.ts:61: `string_of` now returns `INVALID` when the value includes `'\u0000'`. `string_of` is the only check of field type `string` and `value_of` calls it for every `string`, also inside `array`, `object` and `object_union` (body.ts `array_of`, `check_object`, `union_of`), and both `check_json_body` and `check_query` go through `check_value`. So a `string` value holding U+0000 breaks the body rules and is 400 `bad_request` at step 5, before `run_transaction`, as open-game-works-core/skills/server-core/modules/admin-api.md:178 sets. Ran in a temporary copy (see R2-2): with the fix, `grant_items` with `operation_id` `"a\u0000b"` answers 400 `bad_request`; with the old `string_of` it answers 500 `internal` |
| R2-2 | fixed | New tests: server/core/admin-api/tests/rules.test.ts:90 (`refuses a string field holding U+0000 in a JSON body and in a query string`: JSON body `operation_id` and `note`, a `string` inside an `object_union`, query `name=a%00b`, and U+0001 still accepted) and server/core/admin-api/tests/processing.test.ts:83 (`grant_items` with `operation_id` `"a\u0000b"` expects 400 `bad_request`, one more `audit` line and balance 0), which covers the `## test` item at open-game-works-core/skills/server-core/modules/admin-api.md:311. Defect restoration: I copied `server/`, `fixtures/`, `settings/`, `test-data/`, `core-spec/` and `proto/` of HEAD (`git archive`) to a scratch folder outside the checkout, with `server/build/data` from the open-game-works-core-impl main checkout, and changed body.ts:61 back to `typeof raw === 'string' && utf8_length(raw) <= limits.max_string_bytes ? raw : INVALID`. Ran both tests with the ogw-pinned vitest (`OGW_DEFAULT_DB=sqlite`, `-t "U\+0000"`). Without the defect both passed. With the defect both failed: rules.test.ts got a non-null result, and processing.test.ts failed with `expected [ 500, 'internal' ] to deeply equal [ 400, 'bad_request' ]` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- In server/core/admin-api/, the range changed only body.ts `string_of` and the two tests above. The range also changed server/core/block-report, mission and public-profile. admin-api does not refer to those modules (grep of server/core/admin-api/*.ts), and their diffs add or change no admin operation, so I did not review them further for admin-api. The client/godot changes and the records files of the range are outside this target
- I ran the defect restoration only with SQLite (`OGW_DEFAULT_DB=sqlite`) in the scratch copy, not the PostgreSQL run. I did not run the whole admin-api suite through `ogw core test`. The core agent report says the final `ogw core test server admin-api ...` passed on SQLite and PostgreSQL, and I did not run it again
- The server data of the scratch copy (`server/build/data`) came from the open-game-works-core-impl main checkout at 92042ba and was not built from this commit. The two tests use only the item `GOLD` from that data
