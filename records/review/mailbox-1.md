# review mailbox round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The changes of the range in the target are `server/core/mailbox/mail_input.ts` and the tests `server/core/mailbox/tests/{mail-input,send-mail,broadcast}.test.ts` (plus `server/core/admin-api/tests/mail.test.ts`). Checked against `mailbox.md` `## API` (mail input TypeScript and JSON forms, `MailResult`), `### broadcast` and the `## test` items they reach: null fields refused in the TypeScript and JSON forms, `bigint` JSON integers for `int64` and `int32`, safe integer `number` `expire_ms`, `ALREADY_SENT` after `INVALID_INPUT` checks. The callers of `send_mail` and `broadcast_mail` (`ranking/reward.ts`, `rating/index.ts`, `coupon/index.ts`, `admin-api/operations.ts`, `mailbox/index.ts` `grant_or_mail` and broadcast delivery) pass no `null` field, so the stricter null handling does not change their results
- The mailbox tests (69) and `admin-api/tests/mail.test.ts` (4) were run with vitest on SQLite only, with the server build data of `open-game-works-core-impl/server/build/data` (main) instead of a build of this checkout; the PostgreSQL run was not done
- No defect was restored to check the new tests in round 1 (not required); their asserts were read and each checks a value that the changed code produces
- `records/review-debt/mailbox.json` holds item D1 (`int64_json` refuses a `bigint`), but the input `## debt` is `none`, so it has no row here. The code of the range removes that problem: `int64_json` (`server/core/mailbox/mail_input.ts:205`) takes a `bigint` through `json_integer`, and `server/core/mailbox/tests/mail-input.test.ts:167` checks `expire_ms` 86400000n
