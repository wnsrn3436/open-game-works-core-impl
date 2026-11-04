# review iap round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `subscription_status` at server/core/iap/adapters/google.ts:199 gives `VALID` only when the line item of the receipt product has `latestSuccessfulOrderId`, as open-game-works-core/skills/server-core/modules/iap.md:341 now requires, and verify_subscription uses it at server/core/iap/adapters/google.ts:313. Input A (`vip_plus_google` with no order next to `vip_google` with `GPA.owned`, state `ACTIVE`) is now `PENDING`: balance stays 0, with no payment record and no subscription record. Input B (`EXPIRED`, one line item, no order) is now `INVALID` with no grant. In a temporary copy, restoring the defect (`subscription_status` returns `VALID` after the two pending state checks) fails the adapter test at server/core/iap/tests/adapters.test.ts:441 and both `VerifyPurchase` tests at server/core/iap/tests/subscription.test.ts:48. The double grant of input A is also gone: in a scenario run in that copy, with `vip_google` already granted (balance 30), the receipt with no order gave `PENDING` on `VerifyPurchase` and `RecoverPurchase`, balance 30. After the response gained `GPA.plus.1`, it gave `GRANTED`, balance 90, then `ALREADY_GRANTED`, balance 90 |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The real Google Play Developer API was not called. Every Google response in this review was written by hand from Google's documents
- Google's documents agree with the fix but do not settle every case. The `purchases.subscriptionsv2` reference says `latestSuccessfulOrderId` is "Not present if the item is not owned by the user yet (e.g. the item being deferred replaced to)", and the replacement codelab's sample has no order on the replacing line item. Whether a paid subscription can answer with no order on its line item (e.g. a promo code or a purchase older than that field) was not confirmed. Such a receipt would now stay `PENDING`, with no grant and no acknowledgement, and Google refunds and revokes a purchase not acknowledged within 3 days
- A normal client was not run against Google. The codelab says the app's purchase with the new token still names the old product until the replacement. In the scenario run, that receipt gave `ALREADY_GRANTED` with an acknowledgement, so the new token is acknowledged on this path. If a client did send the new product before the replacement, the result is `PENDING` with no acknowledgement, as iap.md requires for `PENDING`, and the 3 day limit above would apply. No finding is written because no document found says a client receives that receipt
- Not judged as a finding, confidence below 80: `SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED` with no order. iap.md:341 gives it `INVALID` in one sentence, and the next sentence reads `INVALID` for `SUBSCRIPTION_STATE_EXPIRED` and `PENDING` otherwise. The code and test give `INVALID` (server/core/iap/adapters/google.ts:200). Neither reading grants
- Tests ran in a temporary copy with `OGW_DEFAULT_DB=sqlite` only, using the built data of the `open-game-works-core-impl/` checkout. PostgreSQL was not run, because `psql` and `pg_ctl` are not on the PATH of this shell; whether the harness has its own PostgreSQL was not checked. The 133 tests of `server/core/iap/tests` pass there
- The scenario run replaced `verify` and `lookup_subscription` of the fake adapter with the real adapter through `answer_as_google`, so acknowledgement was counted on the fake adapter, not sent through the real one
- Other changes were checked by mutation in that copy. `EXPIRED` with no order giving `PENDING`, any line item with an order giving `VALID`, and no order always giving `INVALID` each failed the adapter test and one `VerifyPurchase` test
- Client `PaymentCore` was read only for how it handles a `PENDING` result. The tests of the modules that depend on `iap` were not run, because no finding says something fails outside these tests
- `server/core/iap/grant.ts`, `server/core/iap/index.ts` and `server/core/iap/notify.ts` were read only on the paths that use the verification result and the snapshot. `server/core/iap/adapters/apple.ts` was not read, because the range did not change it and the changed code does not reach it
