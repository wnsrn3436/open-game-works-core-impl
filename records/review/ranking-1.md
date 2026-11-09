# review ranking round 1

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

- The ranking module code and tests did not change in the commit range 625ae189..12ca3c3d (no file under server/core/ranking/ is in the range diff). The review covered the range changes of the modules that ranking calls or that call it: `storage` (new `fail_transaction`, server/core/storage/tx.ts:373, and the `FAILED` result of a marked transaction, server/core/storage/tx.ts:225), `item-ledger` (hook failures call `fail_transaction`, server/core/item-ledger/ledger.ts:448; the `item_ledger_once_key` table keeps the SHA-256 form; misuse throws without a log; history is registered with personal data user column `user_id`), `admin-api` (`list_history` source as the element name; `admin-api.maxSearchRows` minimum 1), `session` (`end_session` deletes only the request's session), `logging` (metrics comment only). None of them changes a result of ranking: ranking does not call `item-ledger` operations (server/core/ranking/deps.ts:103 only checks that the module exists); the season reward `once_key` goes to `mailbox.send_mail`, whose dedupe is the `mailbox_once_key` table (server/core/mailbox/tables.ts:104), not the `item_ledger_once_key` table whose key form changed; a reward handling whose transaction a hook failure marked with `fail_transaction` returns `FAILED` from `run_user_transaction`, which server/core/ranking/reward.ts:147 and the outcome at server/core/ranking/reward.ts:172 already turn into a retry row as ranking spec `## behavior` season reward sets for `FAILED`; a later storage operation on a marked transaction throws, and the body still ends as `FAILED`; `RankingStorage` (server/core/ranking/deps.ts:10) does not pick `fail_transaction`, and ranking spec does not require ranking to call it
- `ogw core test server ranking` (job mw8ltq2d5713f0) passed. It wrote no test record because the checkout had an uncommitted change (the deletion of the earlier records/review/ranking-1.md). Whether its PostgreSQL tests (`testing.hold_db` of the `ranking_season` row, server/core/ranking/tests/reward.test.ts, server/core/ranking/tests/dev.test.ts) ran on PostgreSQL or were skipped for lack of a PostgreSQL server was not checked
- A ranking season reward whose hook `ranking_season_reward` calls an `item-ledger` write that fails an `item-ledger` hook (the new `fail_transaction` path) has no ranking test; it was checked by reading the code path, not by a run. Ranking spec `## test` does not set such a test
- `mailbox`, `server-time`, `live-event`, `guild` and `nickname` implementation code did not change in the range (only server/core/nickname/tests/admin.test.ts) and was not reviewed again
