# review mailbox round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | server/core/mailbox/mail_input.ts:143 | The spec change adds `once_key` holding U+0000 to the `INVALID_INPUT` conditions of `MailResult` (mailbox.md:79) and the `## test` item "`send_mail` with a `once_key` that holds U+0000 is `INVALID_INPUT` and sends no mail" (mailbox.md:222). `check_scalars` (`server/core/mailbox/mail_input.ts:143`) only checks that `once_key` is a string, and `check_mail_input` (`server/core/mailbox/mail_input.ts:193`) passes it on unchanged, so `send_mail(ctx, {template_id: <valid>, once_key: 'a\u0000b'})` passes the check and reaches `deliver` (`server/core/mailbox/index.ts:211`), which runs `Tables.find_once_key` (`server/core/mailbox/tables.ts:105`) with that string as a parameter. storage.md says a statement with a `string` parameter that holds U+0000 fails in both DBs, so the `query` throws and the request is a failed transaction instead of the `INVALID_INPUT` result with an `error` log. No test under `server/core/mailbox/tests/` uses a once_key holding U+0000 (grep for `\u0000` and `\0` finds none), so the mailbox.md:222 `## test` item has no test | In `check_scalars`, return a reason when `once_key` contains `'\u0000'`, so `send_mail` returns `INVALID_INPUT` before any query; add a `send-mail.test.ts` case that sends with `once_key` `'a\u0000b'`, expects `INVALID_INPUT` and mail ID `0n`, and checks that the mailbox has no mail and no `mailbox_once_key` row | no | 92 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range `3f8470a..2a6721a` changes no file under `server/core/mailbox/`: it changes realtime_core client code, public-profile tests and review records. So the only findings come from the definitions changed in the spec changes diff
- The storage.md change (a `string` parameter holding an unpaired surrogate fails in both DBs) defines storage adapter behavior. mailbox.md sets no `INVALID_INPUT` condition for an unpaired surrogate, so a mailbox `once_key` holding one makes the query throw, as before. That is not a mailbox code difference from the definitions, and it was not written as a finding
- `grant_or_mail` with a change source whose `once_key` holds U+0000 runs `Tables.find_once_key` at step 1 (`server/core/mailbox/index.ts:293`) before any mail input check, so it throws. mailbox.md:117 step 1 also queries `mailbox_once_key` first, and the spec does not say which result that input gets before step 3. This is a spec matter for a spec review, not checked here as a code finding
- No tests were run: this checkout has no `node_modules`. R3-1 was checked by reading the code path (`check_scalars` → `check_mail_input` → `deliver` → `find_once_key`) together with the U+0000 rule of storage.md
