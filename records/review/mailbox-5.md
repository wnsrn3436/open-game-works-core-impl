# review mailbox round 5

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | fixed | none | `check_scalars` (`server/core/mailbox/mail_input.ts:145`) returns `once_key holds U+0000` for a string `once_key` that contains U+0000, and `check_mail_input` (`server/core/mailbox/mail_input.ts:175`) returns that failure before any query. The admin-api `send_mail` operation (`server/core/admin-api/operations.ts:228`, `:239`) parses the body with `mailbox.mail_input_from_json` and calls `mailbox.send_mail`, which runs the same check. So `once_key` `"k\u0000"` gives `INVALID_INPUT` (mailbox.md:79) and no longer reaches the storage statement that ended as 500 `internal`. `server/core/mailbox/tests/send-mail.test.ts:112` sends `once_key` `'a\u0000b'` and checks for `INVALID_INPUT`, no mail, no `mailbox_once_key` row and the `error` log reason (fix made in commit `dfd5c0a`, confirmed `fixed` as R3-1 in round 4) |

## must fix

none

## unknown

- The commit range `23eee5b..23eee5b` is empty, so there are no changed places to review. Round 4 had no findings and no `open` rows, so this round checked only debt item D2
- No tests were run. This checkout has no `node_modules`, and core tests run through `ogw core test`. D2 was checked by reading the code path (`operations.ts` → `mail_input_from_json` → `send_mail` → `check_mail_input` → `check_scalars`) and the existing test
- These round 4 notes were not checked again: `grant_or_mail` queries `Tables.find_once_key` at step 1 (`server/core/mailbox/index.ts:293`) before the mail input check, and a `once_key` with an unpaired surrogate has no `INVALID_INPUT` condition in mailbox.md:79. Both are spec matters that existed before this range
