# review: admin-api round 1

## findings

none

## previous

none

## out of scope

- server/core/admin-api/operations.ts:228: medium `mail_of` passes the `mail` `json` value through `output_json` before `mailbox.mail_input_from_json`, so every JSON integer outside the safe integer range becomes a decimal string. `## API` of `mailbox` (mailbox.md:64) says that in the value `mail_input_from_json` receives, a JSON integer is a safe `number` or a `bigint`, and that a value of another type is a wrong format (`INVALID_INPUT`). Repro: `send_mail` with `mail` `{"template_id":<id>,"args":[{"name":"n","value":{"text_value":9007199254740993}}]}` gets 200 and sends a mail whose `text_value` is `"9007199254740993"`, while the same body with `"text_value":5` gets 400. Checked with node: `mail_input_from_json(output_json({template_id:1,args:[{name:'n',value:{text_value:9007199254740993n}}]}))` returns a mail input with `text_value` `"9007199254740993"`. The same happens for `name`, `once_key` and attachment `big_amount` given as JSON integers past 2^53. The line is unchanged since the initial commit
- server/core/mailbox/mail_input.ts:196: medium `int64_json` takes only a safe `number` or a decimal string, and returns null for a `bigint`. mailbox.md:64 says a JSON integer can reach `mail_input_from_json` as a `bigint`, and the `## test` item at mailbox.md:237 says `expire_ms` given as the `bigint` 86400000 reads the same as 86400000. Checked with node: `mail_input_from_json({template_id:1, expire_ms:86400000n})` returns null. No mailbox test passes a `bigint`. This is why admin-api turns integers into strings (see the item above)

## debt

none

## must fix

none

## unknown

- I did not run the admin-api core tests. This host has no `OGW_POSTGRESQL`, so I could not check the PostgreSQL-only tests at all (the `LOCK TABLE admin_api_switch` start failure in `tests/switches.test.ts`, and the `operation_id` row lock in `tests/items.test.ts` on PostgreSQL). Among those unchecked tests: whether `storage.read_db` in `complete_start()` stops waiting on the held table lock (so the peer start fails rather than hangs) depends on `storage`'s statement and lock timeouts. I did not check that here
- I did not review `server/core/auth/admin.ts`, `server/core/chat/admin.ts`, `server/core/game-update/admin.ts` or the coupon, guild and nickname admin tests changed in the range. They belong to those modules' targets. I only checked that they still match admin-api's handler function contract (return a failure reason string or an object)
- Very deeply nested JSON in a `json` field: the new parser in `json.ts` returns null (400) once its stack overflows, but the recursive `plain_json` in `body.ts` (via `value_of`) can overflow at a smaller depth. That gives a thrown `RangeError`, which `handle` answers with 500 `internal` and an `error` log. Node probes did not give a stable depth threshold (it moved with JIT warm-up), and the spec sets no depth limit. So I wrote no finding
- I did not check the client core, the other server modules and the tool changes elsewhere in the commit range, since they are outside the admin-api target
