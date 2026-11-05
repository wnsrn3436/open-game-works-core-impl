# review: admin-api round 4

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R4-1 | spec | medium | server/core/admin-api/body.ts:61 | open-game-works-core/skills/server-core/modules/admin-api.md:179 (changed in this range) says a string anywhere in the input holds no unpaired surrogate, a body rules violation that is 400 `bad_request` at step 5. `string_of` checks only U+0000 and the byte length. `Parser.#string` (json.ts:66-77) decodes `"\ud800"` with `JSON.parse` into a lone surrogate, and nothing else refuses it. Run in a scratch copy of HEAD (SQLite, `OGW_DEFAULT_DB=sqlite`): `grant_items` with body `{"operation_id":"\ud800","user_id":"<id>","items":[GOLD 1]}` answers 200, the GOLD balance becomes 1. The spec `## test` item at admin-api.md:312 expects 400 | Refuse a string that is not well formed (`!raw.isWellFormed()`, or a scan for an unpaired surrogate) in `string_of`, next to the U+0000 check | no | 95 |
| R4-2 | spec | medium | server/core/admin-api/body.ts:127 | admin-api.md:179 (changed in this range) applies the U+0000 and unpaired surrogate rule to strings "also inside a `json` field". The `json` case calls only `plain_json` (json.ts:154-169), which checks numbers and passes every string (and object member name) as it is. Run in the scratch copy (SQLite): `send_mail` with `mail` `{"template_id":<[mail_admin_notice]>,"args":[{"name":"text","value":{"text_value":"a\u0000b"}}]}` answers 200 and `get_user` shows a mail whose `text_value` is `"a\u0000b"`; the same with `text_value` `"\ud800"` answers 200 and the mail holds U+FFFD; with `once_key` `"k\u0000"` it answers 500 `internal` instead of 400 `bad_request`; with `once_key` `"\udc00"` it answers 200. The same path serves the `json` fields of remote-config (server/core/remote-config/index.ts:383, 430) and game-update (server/core/game-update/admin.ts:88) | Make `plain_json` (or the `json` case) return the invalid result when a string value or an object member name anywhere in the value holds U+0000 or an unpaired surrogate | no | 95 |
| R4-3 | test evidence | medium | server/core/admin-api/tests/processing.test.ts:83 | The `## test` item at admin-api.md:312 (changed in this range) adds a `grant_items` whose `operation_id` is the JSON text `"\ud800"` is 400. The only test of that item sends `"a\u0000b"`; no admin-api test sends an unpaired surrogate (grep of `ud800`, `surrogate` in server/core/admin-api/tests/ finds none), and none sends U+0000 or a surrogate inside a `json` field. The current code passes every admin-api test while answering 200 to that request (R4-1) | Add the `"\ud800"` case to the test at processing.test.ts:83 (400 `bad_request`, one `audit` line, balance 0), and a rules.test.ts case for U+0000 and an unpaired surrogate inside a `json` field value and member name | no | 90 |

## previous

none (round 3 had no findings and no open rows)

## out of scope

- server/core/mailbox/mail_input.ts:143: medium open-game-works-core/skills/server-core/modules/mailbox.md:79 (changed in this range) makes a `once_key` that holds U+0000 `INVALID_INPUT`, but the mail input check accepts any string `once_key`; in the scratch copy `send_mail` through admin-api with `once_key` `"k\u0000"` ends as 500 `internal` (the storage statement fails) instead of `INVALID_INPUT`
- server/core/storage/db/sqlite.ts:49: medium open-game-works-core/skills/server-core/modules/storage.md:307 (changed in this range) says a statement with a `string` parameter that holds an unpaired surrogate fails in both DBs, but the SQLite adapter refuses only U+0000; in the scratch copy `grant_items` with `operation_id` `"\ud800"` committed on SQLite, and a mail `text_value` `"\ud800"` was kept as U+FFFD

## debt

none

## must fix

none

## unknown

- The commit range changes no file of server/core/admin-api/; the findings come from the definitions that input `## spec changes` changes (admin-api.md:178-179 and :312). The other code changes of the range (client/godot realtime_core, server/core/public-profile tests, records) are outside admin-api, which does not refer to them
- The reproductions ran in a scratch copy of HEAD (`git archive` of server, fixtures, settings, test-data, core-spec, proto, with `server/build/data` from the open-game-works-core-impl main checkout at 2a6721a, the same commit) with the ogw-pinned vitest and `OGW_DEFAULT_DB=sqlite` only. I did not run them on PostgreSQL, where storage.md:307 says the statement fails, so there the R4-1 request would likely answer 500 rather than 200; either way it is not 400
- I did not run the whole admin-api suite
