# review iap round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/iap/notify.ts:286 | `claim_only` (added in 5b862041) is the whole handling of a `SUBSCRIPTION` notification whose lookup result is `gone`, and `### store notification` says "When the handling fails, it answers HTTP 500 so that the store sends again". Its failure branch (`run_game_transaction` gives `FAILED` → `error` log `iap store notification processing failed` and HTTP 500) is not run by any test: the only `GONE` notification tests (server/core/iap/tests/gone.test.ts:172, :192) let the game transaction commit, and the only test that replaces `storage.run_game_transaction` is server/core/iap/tests/refund-lookup.test.ts:114, which does not send a `SUBSCRIPTION` notification. Changing line 286 to `return OK;` keeps every test passing while a failed claim would answer HTTP 200 | Add a test in which the fake `iap-google` lookup is `GONE`, the game transaction of the claim fails (e.g. `storage.run_game_transaction` returns `FAILED` for that call), and assert HTTP 500, one `error` log, and that the same notification ID sent again afterwards is handled (not a duplicate) | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The core tests were not run (`server/` has no installed dependencies in this checkout; `ogw core test` was not started). Whether server/core/iap/tests/gone.test.ts and the changed parts of server/core/iap/tests/adapters.test.ts pass was checked only by reading them against the code
- server/core/testing/tests/fake.test.ts calls `lookup_subscription` and was not read for the new `gone` result type; the type check of `ogw code check` covers it
- The changes of the range in storage (`fail_transaction`), item-ledger (hook failures fail the transaction) and idempotency were read only for how they reach the iap call sites (grant.ts:127, grant.ts:403, index.ts:306 catch hook throws and return an error code, so the transaction rolls back either way); their own behavior belongs to the reviews of those modules
- The real `iap-google` HTTP 410 answer for `purchases.subscriptionsv2` was not checked against the live Google API; it was checked only against the rule of iap.md:384
