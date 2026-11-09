# review mailbox round 1

## findings

none

## previous

none

## out of scope

- server/core/mailbox/tables.ts:28: medium `mailbox_once_key` keeps the raw `once_key` as part of its primary key `(user_id, once_key)` (server/core/storage/schema.ts:197), and no mailbox input rule limits the length of `once_key` (mailbox.md:79 only refuses U+0000). On PostgreSQL a btree entry over 2704 bytes cannot be inserted, so `send_mail` with a `once_key` of about 3000 incompressible bytes, or `grant_or_mail` whose `add_items` is `LIMIT_EXCEEDED`/`REJECTED` with such a change-source `once_key`, fails at `Tables.insert_once_key` (server/core/mailbox/index.ts:227) and the request is `INTERNAL` instead of a `MailResult`. Commit 8ba7373a fixed the same problem in `item_ledger_once_key` by keeping the SHA-256 form (item-ledger.md:174); the mailbox spec and table were not changed. Fix: keep a fixed-length form (e.g. SHA-256) in `mailbox_once_key` as item-ledger does, or set a byte limit on `once_key` as an `INVALID_INPUT` condition
- server/core/mailbox/index.ts:211: medium `send_mail` accepts a `once_key` that holds an unpaired surrogate (mail_input check refuses only U+0000). The driver writes the string as UTF-8, where every unpaired surrogate becomes U+FFFD, so two different `once_key`s such as `a\uD800` and `a\uDBFF` are the same `mailbox_once_key` row, and the second `send_mail` returns `ALREADY_SENT` with the mail ID of the first and sends no mail. Commit 8ba7373a made item-ledger refuse such a `once_key` (item-ledger.md:59), but the mailbox spec (mailbox.md:79) does not. Fix: make an unpaired surrogate in `once_key` an `INVALID_INPUT` condition of the mailbox spec and of `check_mail_input`

## debt

none

## must fix

none

## unknown

- The commit range 625ae189..f3070655 changes no file under `server/core/mailbox/`. What was checked is how the dependency changes of that range reach mailbox:
  - `item-ledger` hook failures now call `storage.fail_transaction` (server/core/item-ledger/ledger.ts:446). In `ClaimAllMail` (server/core/mailbox/index.ts:363), a hook failure inside one mail's `add_items` throws out of `run_savepoint`; when content code inside `grant_mail_extra` catches such a throw and returns a `GameError`, `run_savepoint` sees `broken` and throws (server/core/storage/tx.ts:324). Either way the whole request is `FAILED`/`INTERNAL`, which matches mailbox.md:108 and item-ledger.md:189. Mailbox catches no throw of `add_items`
  - `item-ledger` misuses (core prefix, unpaired surrogate, a core source that is none) now throw without a log. Content `send_mail`/`grant_or_mail` with a core `once_key` prefix are refused by mailbox itself with its own `error` log before `add_items` (server/core/mailbox/index.ts:466), as mailbox.md:71 sets
  - `item-ledger` `once_key` table keeps the SHA-256 form: `ClaimMail` `mail:<mail ID>` and `grant_or_mail` `AlreadyApplied` go through `has_once_key`/`put_once_key`, which both hash, and the `AlreadyApplied` test passed. Mailbox does not read `item_ledger_once_key` directly
  - `item-ledger` history `source` as the enum value: mailbox does not read history
  - `storage` `fail_transaction` and `not_failed`: the throw on a marked transaction in `on_request_start` is caught and logged (server/core/mailbox/index.ts:459)
  - `logging` metrics.ts: comment change only
- `ogw core test server mailbox` passed on this checkout. The core tests of the modules that mailbox depends on were not run, as `ogw review run` runs them
- The PostgreSQL btree limit and the U+FFFD replacement of the out-of-scope items were not run against a database; they are from the table DDL and the UTF-8 encoding of the driver
- The whole mailbox target was not reviewed again outside the dependency changes, as the commit range is not `none`
