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

- The commit range 85f6b36d..d6a6cea4 changes no file under `server/core/mailbox/`. What was checked is how the dependency changes of that range reach mailbox:
  - `item-ledger` (server/core/item-ledger/history.ts, ledger.ts): the history counter `item_ledger_history_seq` with plain inserts, and the `once_key` expiry now set by `item-ledger.onceKeyRetentionMs`. The `add_items` calls of `ClaimMail`/`ClaimAllMail` (server/core/mailbox/index.ts:314) run inside the request transaction or `storage.run_savepoint` (index.ts:363), so a rolled-back mail also rolls back its history counter step. A throw from a failed history insert is not caught by mailbox and ends the request with `INTERNAL`, as mailbox.md:108 says. The `once_key` `mail:<mail ID>` uses a mail ID that is never issued again and the mail is deleted on claim, so the shorter `once_key` retention does not let a mail be claimed twice. `grant_or_mail` step 1 reads `mailbox_once_key`, which never expires, so it does not depend on that retention
  - `storage` (server/core/storage/tx.ts, index.ts): the seed provider signature and `make_seed`, `watch_db_wait`, `read_db_metrics`. Mailbox does not use random seeds or these operations. The out-of-request change of `on_request_start` (index.ts:454) passes no request fields, so it gets a secure seed as before
  - `logging` (server/core/logging/index.ts): metrics counted per written line. The mailbox `write` calls (index.ts:192) are unchanged in kind and level
  - `routing` (server/core/routing/pipeline.ts, server_process.ts): request workers and the front process. Mailbox keeps no per-process state except `hook_slots`, which every server instance fills, and the call of `on_request_start` (pipeline.ts:658) is unchanged
- `ogw core test server mailbox` passed on this checkout. The core tests of the modules that mailbox depends on were not run, as `ogw review run` runs them
- The whole mailbox target was not reviewed again outside the dependency changes, as the commit range is not `none`
