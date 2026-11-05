# review: admin-api round 6

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R6-1 | spec | medium | server/core/admin-api/operations.ts:228 | Debt D5 is still there. `mail_of` passes the `mail` `json` value through `output_json` before `mailbox.mail_input_from_json`, so a JSON integer outside the safe integer range (a `bigint` after `plain_json`, json.ts:163) becomes a decimal string. skills/server-core/modules/mailbox.md:64 says that in the value `mail_input_from_json` receives, a JSON integer is a safe `number` or a `bigint`, and that a value of another type (e.g. an integer for `text_value: string`) is a wrong format, `INVALID_INPUT`. skills/server-core/modules/admin-api.md:193 makes that 400 `bad_request`. Scratch run of the current code: `check_json_body` on `{"operation_id":"a","user_id":1,"mail":{"template_id":1,"args":[{"name":"n","value":{"text_value":9007199254740993}}]}}`, then `mail_input_from_json(output_json(mail))`, returns a mail input with `text_value` `"9007199254740993"`, so `send_mail` sends it and answers 200. The same body with `"text_value":5` gives `null` (400), and `mail_input_from_json(mail)` without `output_json` gives `null` for the large value too. The same holds for `once_key` and a `MailArg` `name` given as a JSON integer past 2^53, in `send_mail` and `broadcast_mail` | Pass the checked `json` value to `mailbox.mail_input_from_json` as it is; `json_integer` of mail_input.ts:201 already takes a `bigint`. Add a test where `send_mail` with `text_value` 9007199254740993 as a JSON integer is 400 | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | `plain_json` (server/core/admin-api/json.ts:161) now returns undefined for a `JsonNumber` whose text is not an integer text, so `1e999` breaks the `json` field rule and no `Infinity` reaches `canonical_json`. Every other number becomes a safe `number` or a `bigint` (json.ts:162-163), which `canonical_json` writes. Scratch run: `check_json_body` on `{"operation_id":"a","user_id":1,"mail":{"x":1e999}}` returns `null` (400 at step 5); a 400-digit JSON integer in `mail` passes as a `bigint` |
| D2 | fixed | none | `check_query` (server/core/admin-api/body.ts:176) now builds `raw` with `Object.create(null)`, so `__proto__` is an own key and `check_object` refuses it as an unknown field (body.ts:140). Scratch run: `check_query({user_id: int64}, 'user_id=1&__proto__=x')` returns `null` |
| D3 | fixed | none | `run_transaction` (server/core/admin-api/index.ts:418-436) sets `box.lock_failed` when `lock_game_row` is `FAILED` and writes the `error` line for it as well as for a `FAILED` transaction. `get_user` and `export_personal_data` (server/core/admin-api/operations.ts:132-134, :150-152) call `log_error` before `fail('internal')` when `read_user` is `FAILED` (which also covers `REJECTED`, operations.ts:118). Checked by reading the code |
| D5 | open | R6-1 | operations.ts:228 is unchanged: `mail_of` still calls `output_json` on the `mail` value. Reproduced in a scratch run, see R6-1 |
| D6 | fixed | none | `string_of` (server/core/admin-api/body.ts:60) now requires `is_clean_text` (json.ts:149), which refuses U+0000, and skills/server-core/modules/admin-api.md:179 makes that `bad_request`. Scratch run: `check_json_body` with `operation_id` `"a\u0000b"` returns `null`, so `write_operation` never gets it |

## must fix

none

## unknown

- The commit range is empty (bd21cac..bd21cac), so no change was reviewed. I checked only the input `## debt` items against the code at HEAD
- I made the scratch runs with node 26 type stripping on `body.ts`, `json.ts` and `mailbox/mail_input.ts` directly, not through a running test server, and I did not run the admin-api test suite. For R6-1 I did not send `send_mail` end to end; the 200 is inferred from `send_mail` (operations.ts:233-236) taking the mail input that `mail_of` returned
- D3 was judged by reading the code; I did not force a lock wait timeout or a deadlock
