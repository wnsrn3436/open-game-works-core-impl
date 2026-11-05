# review mailbox round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `check_scalars` (`server/core/mailbox/mail_input.ts:145`) now returns `once_key holds U+0000` for a string `once_key` that contains U+0000. `check_mail_input` (`server/core/mailbox/mail_input.ts:175`) returns that failure before `send_mail` (`server/core/mailbox/index.ts:231`) reaches `deliver` and `Tables.find_once_key`, so `send_mail` returns `{result: INVALID_INPUT, mail_id: 0n}` with the `error` log `send_mail input is invalid`, as mailbox.md:79 requires. `broadcast_mail` (`index.ts:376`) and the broadcast path of `on_request_start` (`index.ts:445`) use the same check. The `## test` item at mailbox.md:222 is now tested by `server/core/mailbox/tests/send-mail.test.ts:112`. That test sends `once_key` `'a\u0000b'` and checks the result, that there is no mail, that there is no `mailbox_once_key` row (`read_user_rows` inside a rollback transaction) and that the `error` log has the reason. Without the fix the input reaches `find_once_key` and the query throws (storage.md U+0000 rule), so the test fails. The core agent report records that failure on both DBs |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The only mailbox changes in the commit range are `server/core/mailbox/mail_input.ts` and `server/core/mailbox/tests/send-mail.test.ts` (commit `dfd5c0a`). The other changes are in other modules: admin-api, coupon, matchmaker, nickname, routing, VirtualPadCore and review records. The admin-api change (`server/core/admin-api/body.ts:61`, `json.ts:149`) refuses U+0000 and unpaired surrogates in admin request strings before they reach `mail_input_from_json`. It does not change any mailbox behavior that mailbox.md defines
- `grant_or_mail` with a change source whose `once_key` holds U+0000 still queries `Tables.find_once_key` at step 1 (`server/core/mailbox/index.ts:293`) before any mail input check, so the query throws. mailbox.md:117 step 1 queries `mailbox_once_key` first and does not say which result that input gets before step 3. This existed before the range and the range does not change it. It is a matter for a spec review and was not written as a finding
- A `once_key` that holds an unpaired surrogate still makes the query throw. mailbox.md:79 sets no `INVALID_INPUT` condition for it, as round 3 noted
- No tests were run. This checkout has no `node_modules` (`server/package-lock.json` lists no packages), and core tests run through `ogw core test`, which needs the DB tools of the harness. R3-1 was checked by reading the code path (`check_scalars` → `check_mail_input` → `send_mail`) and the added test. The test's failure without the fix comes from the core agent report and was not rerun here
