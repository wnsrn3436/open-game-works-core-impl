# update core: mailbox

## done

- module: `mailbox` (server). Commit bbd0c88 on `agent/mw3k54ng2c3dea`
- `server/core/mailbox/mail_input.ts`
  - JSON form (`mail_input_from_json`): a JSON integer is a safe integer `number` or a `bigint`. `int64` values (`expire_ms`, `amount`, `int_value`) take a `bigint` within the int64 range, and `int32` values (`template_id`, `extra_id`, `item_id`) take a `number` or `bigint` within the int32 range and come out as `number`. This fixes debt item D1 (`server/core/mailbox/mail_input.ts:196`)
  - JSON form: a `null` optional field (`amount`, `big_amount`, `expire_ms`) is now a wrong format. Before, `?? default` read it as the missing field
  - TypeScript mail input (`check_mail_input`): `args`, `attachments` and `expire_ms` that are `null` are now `INVALID_INPUT` (only `undefined` is a left-out field). `MailInput.expire_ms` is typed `bigint | number`, as the spec's field types say (the check already took a safe integer `number`)
- Already matched the current spec, unchanged: MailArg kind resolution and default-value rule, `ALREADY_SENT` only after every `INVALID_INPUT` check (`deliver` runs after `check_mail_input`), broadcast row `mail` with int64 as decimal strings (`mail_to_json`), request start reading the row with `mail_input_from_json` and skipping with an `error` log on `INVALID_INPUT`
- `skills/server-core/SKILL.md` diff (`request` log field for routes, truncated IP form) does not reach mailbox: mailbox writes no IP, and its `request` field is `ctx.request_name`
- New core tests
  - `tests/send-mail.test.ts`: MailArg kind cases of the `## test` item (5n with '' → Int; Text kind with 0n → Text; 0n with 'x', name only, Int kind with text_value → INVALID_INPUT; 5n → Int); `once_key` `gift` with `expire_ms` over `mailbox.maxExpireMs` after a sent `gift` → INVALID_INPUT; only `template_id` → no args, no attachments, `extra_id` 0, no `mailbox_once_key` row, expires at sent time + `mailbox.defaultExpireMs`; `null` fields refused, `undefined` fields and a `number` `expire_ms` taken
  - `tests/broadcast.test.ts`: `int_value` 9007199254740993 kept exactly in the mail and stored as `"9007199254740993"` in `mailbox_broadcast.mail`
  - `tests/mail-input.test.ts`: `expire_ms` as 86400000, `"86400000"` and 86400000n read the same; `bigint` int32 fields; INVALID for `template_id` `"1"`, an attachment key outside `item_id`/`amount`/`big_amount`, an unknown key, no `template_id`, an `args` element without `value`, an attachment without `item_id`, `null` fields, integers outside int32/int64; TypeScript `null` fields
- Last `ogw core test server` over mailbox and its dependents (admin-api ads-reward attendance auth coupon gacha iap matchmaker mission notice ranking rating routing shop testing): pass on SQLite and PostgreSQL. `ogw code check core`: pass
- No engine-specific implementation rules document and no `## <engine> build` of `tools/ogw.md` were written

## spec proposals

none

## review

none

## unverified

- The static check `format args` (spec mailbox `## API`, mail input) is implemented in the harness at `open-game-works-core/tools/src/commands/check/static/format-args.ts`, outside this worktree and outside what a core agent may edit. Whether it matches the changed rule (`kind` property access `MAIL_ARG_KIND_INT`/`MAIL_ARG_KIND_TEXT`, element rules, spread property) was not checked
- `admin-api` turns integers into strings before it calls `mail_input_from_json` (the reason given in debt item D1). That code is in `admin-api` and was not changed; it still works with the fixed `mail_input_from_json`
- Debt item D1 is fixed, but `records/review-debt/mailbox.json` of `open-game-works-core-impl/` was not edited (it is not in this worktree's change)
- In the first dependents run, `testing` `tests/background.test.ts` ("a job run of server start that does not end within testing.backgroundWaitTimeoutMs") failed with `wait_background did not end within 1000 ms`. The same file passed alone on both DBs, and the full set passed on the next run. It looks like a timing flake under load; the cause was not reproduced, and mailbox code is not on that path
