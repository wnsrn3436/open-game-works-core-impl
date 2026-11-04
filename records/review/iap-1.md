# review iap round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | security | medium | server/core/iap/adapters/google.ts:186 | A subscription receipt whose product line item has no `latestSuccessfulOrderId` (no paid order for that product) is `VALID` (google.ts:305) with the purchase token as its transaction ID, so grant order 7 and 8 give `reward` for a product with no paid order. `receipt_of` takes `productId` from the client's JSON (google.ts:100), and `verify_subscription` only checks that it is a line item of the token (google.ts:302). The range caused this: it replaced the `latestOrderId` fallback with the purchase token. Reproduced in a temporary copy. Input A: `subscriptionsv2` answers `SUBSCRIPTION_STATE_ACTIVE` with lines `vip_google` (`latestSuccessfulOrderId` `GPA.owned`) and `vip_plus_google` (no order), the case that google.ts:129 names as a line item deferred to. The receipt `{productId: vip_plus_google, purchaseToken: new-token}` gives adapter transaction `new-token`, SKU `vip_plus_google`, `VALID`, and snapshot latest `GPA.owned`, SKU `vip_google`. Feeding those values through the fake adapter gives `GRANTED`, balance 30 to 90, and a `GRANTED` payment record with `spend_amount` 9000 that counts in monthly spend. A later `SUBSCRIPTION` notification with the real order `GPA.plus.1` grants the same reward again, balance 150. Input B: `SUBSCRIPTION_STATE_EXPIRED` with one line and no order gives transaction `exp-token` and snapshot `EXPIRED` with an empty latest transaction ID. The ended check at server/core/iap/grant.ts:573 compares `exp-token` with the empty value and does not match, so the result is `GRANTED`, balance 0 to 30. The spec requires both behaviors: open-game-works-core/skills/server-core/modules/iap.md:341 (`else the purchase token`, `VALID otherwise`) and iap.md:130 (only the transaction ID as the latest transaction ID is `INVALID`) | Change the spec and the adapter so that a subscription receipt whose product line item has no `latestSuccessfulOrderId` is not granted: not `VALID` when any other line item has an order, and for a response with no order at all, decide from the state, with `EXPIRED` and `REVOKED` giving `INVALID`. Keep the purchase token only where the spec names a case that is paid without an order. Change the test at iap.md:452 and server/core/iap/tests/adapters.test.ts:441 to match, and add a server test for inputs A and B | yes | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Real Google responses were not called. Whether a normal client receives a receipt that names the product deferred to is not settled: Google's billing documents and its codelab differ on whether the new token is visible before the replacement, and the codelab describes it with the old product. So R1-1 is rated as specific input (a forged `productId`, or input B), not normal use. Whether Google answers `EXPIRED` with no order on any line was not checked either
- That a line item deferred to has no `latestSuccessfulOrderId` comes from server/core/iap/adapters/google.ts:129 and iap.md:452. The Google pages found in this review did not confirm it
- R1-1 input A at grant level ran through the fake adapter with the values the real `iap-google` adapter returned for the same response, not through one server with the real adapter
- Tests ran in a temporary copy with `OGW_DEFAULT_DB=sqlite` only, using the built data of the `open-game-works-core-impl/` checkout. PostgreSQL was not run. The 130 tests of `server/core/iap/tests` pass there
- The new tests were checked by mutation in that copy. Removing the entitled state gate of subscription apply, removing the ended check, dropping `EXPIRED` from the ended states, removing the preference for paid line items, removing the `productId` tie order and restoring the `latestOrderId` fallback each made at least one new test fail
- `server/core/iap/adapters/apple.ts`, `server/core/iap/notify.ts`, `server/core/iap/index.ts` and `server/core/iap/dev/adapters/fake.ts` were read only for how they use the changed code. The other files of the module were not read in full, because they are outside the changed places
- The test flag of a Google subscription (`testPurchase` at server/core/iap/adapters/google.ts:119 against `purchaseType` at iap.md:169) was not judged here. It is already D1 of records/review-debt/spec-iap.json, which is not in the input of this review
