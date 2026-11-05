# review mailbox round 2

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | `int64_json` (`server/core/mailbox/mail_input.ts:205`) now reads through `json_integer` (`server/core/mailbox/mail_input.ts:199`), which returns a `bigint` as is, so a `bigint` JSON integer is accepted within the int64 range as mailbox.md:64 says. Checked with node (type stripping) on this checkout: `mail_input_from_json({template_id:1, expire_ms:v})` gives `expire_ms` 86400000n for `v` = 86400000, `'86400000'` and 86400000n, and null for 2n**63n; `{template_id:2n, extra_id:3n, attachments:[{item_id:4n, amount:5n}]}` reads as `template_id` 2, `extra_id` 3, attachment `{item_id:4, amount:5n}`. The mailbox.md:237 `## test` item is covered by `server/core/mailbox/tests/mail-input.test.ts:167`, which passes 86400000n |

## must fix

none

## unknown

- The commit range `3f8470a..3f8470a` is empty, so there are no changed places; round 1 had no findings and there are no core agent reports, so this round checked only the input `## debt` item D1
- The vitest suite was not run: this checkout has no `node_modules` for the server; D1 was checked by calling `mail_input_from_json` directly with node 26 type stripping, which imports `mail_input.ts` and the generated contract of this checkout
- The admin-api path that D1 mentions (turning integers into strings before `mail_input_from_json`) is outside the mailbox target and was not reviewed
