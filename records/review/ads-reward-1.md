# review ads-reward round 1

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

- The commit range changes no file in `server/core/ads-reward/` or `server/core/mailbox/`. It changes these dependencies of ads-reward: `item-ledger` (`ledger.ts`, `history.ts`), `storage` (`core.ts`, `index.ts`, `tx.ts`, adding `fail_transaction`), `logging` (`metrics.ts`, a comment only) and the `idempotency` tests. They were read only where ads-reward reaches them. A hook failure of `item-ledger` inside `mailbox.grant_or_mail` (grant order step 1, `server/core/ads-reward/grant.ts:91`) or inside an item change made by `grant_ad_extra` now calls `storage.fail_transaction`, so `run_user_transaction` of the callback (`server/core/ads-reward/callback.ts:142`) is `FAILED` and the callback answers HTTP 500 with an `error` log (`callback.ts:162`). That also happens when `grant_ad_extra` catches the throw and returns a `GameError`: `run_savepoint` throws on the broken transaction (`server/core/storage/tx.ts:324`). This matches `item-ledger.md` ("an out-of-request change is `FAILED`") and the HTTP 500 of a callback DB failure in `ads-reward.md`. `FakeAdCallback` answers `INTERNAL` in that case. The SHA-256 form of the `item-ledger` `once_key` table is internal to `item-ledger`: ads-reward passes `once_key` `ad:<reward notify ID>` only through `mailbox.grant_or_mail`, and the reward notify ID is a lowercase UUID v4 (callback) or the key of an existing ticket (`FakeAdCallback`), so it never holds an unpaired surrogate. The rest of those modules is outside this target and was not reviewed
- `ogw core test server ads-reward` (job mw8k64a6499de1, host load average about 30) passed the sqlite run and failed 4 tests in the postgresql run: `fake-callback.test.ts` (`wait_background did not end within 10000 ms`), `grant.test.ts` (`the test server has stopped`), `hooks.test.ts` and `settings.test.ts` (server start tests over the 60000 ms test limit). On reruns, `fake-callback.test.ts` passed (job mw8knkh4a14198). `hooks.test.ts` failed again (job mw8ko7d7989a84), once at the 60000 ms limit and once with `storage: the schema lock: the connect to PostgreSQL went over its time limit`. The failures are in server start and in the PostgreSQL connect, not in ads-reward code, and they differ between runs. No change of the range touches the storage connect or server start. The cause was not reproduced or checked, so the postgresql results of those tests are unknown
