# review: admin-api round 7

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R6-1 | fixed | `mail_of` (server/core/admin-api/operations.ts:228) now passes the checked `json` value to `mailbox.mail_input_from_json` without `output_json`, so a JSON integer past 2^53 reaches it as the `bigint` that `plain_json` (server/core/admin-api/json.ts:163) made. `json_integer`/`int64_json` (server/core/mailbox/mail_input.ts:201-209) take it for `int_value`, `expire_ms` and `amount`. `arg_from_json`, `scalars_from_json` and `item_from_json` (mail_input.ts:227-247, :278-284) refuse it for `text_value`, `name`, `once_key` and `big_amount`, which matches skills/server-core/modules/mailbox.md:64. Scratch run (node 26 type stripping on body.ts, json.ts and mail_input.ts): `check_json_body` then the `mail_input.ts` `mail_input_from_json(input.mail)` gives `null` for `text_value` 9007199254740993, `once_key` 9007199254740993, `MailArg` `name` 9007199254740993 and attachment `big_amount` 9007199254740993, all four of which gave a mail input through the old `mail_input_from_json(output_json(...))`. `int_value` and `expire_ms` 9007199254740993 still give a mail input with `bigint` values. The new test server/core/admin-api/tests/mail.test.ts:50 checks 400 for `send_mail` and `broadcast_mail` and no `mail_user_state` for the target user; the core agent report says it failed with `expected 200 to be 400` on the code before the fix |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D5 | fixed | none | Same problem as R6-1. server/core/admin-api/operations.ts:228 no longer calls `output_json` on the `mail` value; the scratch run in `## previous` R6-1 shows a JSON integer past 2^53 for `text_value`, `once_key`, a `MailArg` `name` and `big_amount` is now `INVALID_INPUT` |

## must fix

none

## unknown

- I did not run the admin-api core test suite or `mail.test.ts` myself, and did not restore the defect to run the new test; R6-1 is a `spec` finding, so I judged it from the code and the scratch run. That the new test fails on the old code comes from the core agent report
- The scratch run called `check_json_body` and `mail_input_from_json` directly, not through a running test server, so the 400 answers of `send_mail` and `broadcast_mail` are inferred from the raw function giving `null`, which the `mailbox` wrapper `input_from_json` (server/core/mailbox/index.ts:390-395) turns into `INVALID_INPUT`, which `send_mail` and `broadcast_mail` answer as `bad_request` (operations.ts:238, :250)
- The other changes in the range (storage `scan_users`, `check_text_param`, the `tx.ts` `body` failure rule, PaymentCore, auth, push and ads-reward tests) are outside admin-api. admin-api calls `storage.read_db()` only outside transaction functions (operations.ts:123, :138-139, :144, :157; index.ts:183, :319, :375, :522), and its strings that reach the DB pass `is_clean_text` (json.ts:149), so the new `read_db` throw rule and the unpaired surrogate check do not change its behavior. I did not check how the `tx.ts` change affects the `FAILED` result that `run_transaction` (index.ts) relies on beyond reading that `body` still returns `FAILED` for a lock or connection failure of a statement that broke the transaction
