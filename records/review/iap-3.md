# review iap round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | server/core/iap/adapters/apple.ts:185 | `verification_of` compares only `bundleId` with the app, while open-game-works-core/skills/server-core/modules/iap.md:324 and iap.md:340 also require `INVALID` when `appAppleId` of production store transaction info differs from `iapApple.appAppleId`. Reproduced in a temporary copy: signed transaction info with `environment` `Production` and `appAppleId` 9 on an adapter with `app_apple_id` 1234 gave `VALID`. The spec line cannot be followed. Apple's `JWSTransactionDecodedPayload` reference (developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload) lists 36 properties and `appAppleId` is not one of them. Apple's app-store-server-library-node (`jws_verification.ts`) compares `bundleId` and `environment` for a transaction, and `appAppleId` only for a notification and an app transaction. Applying the spec line to the code in that copy made signed transaction info with `Production` and no `appAppleId`, the form Apple documents, `INVALID`, so every production receipt would fail | Change iap.md:324 and iap.md:340 so that `appAppleId` is compared only for notifications, and transaction info is compared by `bundleId`. Leave the code as it is: `is_app_notification` at server/core/iap/adapters/apple.ts:190 and its test at server/core/iap/tests/adapters.test.ts:316 already do this | yes | 95 |

## previous

none. Round 2 had no findings and no open rows

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | iap.md:211 now grants a new subscription period only when the snapshot `state` is `ACTIVE` or `GRACE_PERIOD`, and server/core/iap/grant.ts:336 checks `is_entitled_state(snapshot.state)`. The tests at server/core/iap/tests/subscription.test.ts:86 and server/core/iap/tests/subscription.test.ts:98 run the item's input and pass: `REVOKED` naming `sub-2` leaves the balance, no payment record of `sub-2` and `state` `REVOKED`. In a temporary copy, removing that check from grant.ts:336 failed those two tests and the `VerifyPurchase` and `RecoverPurchase` test after them |
| D2 | fixed | none | `latest_order_of` is gone. `subscription_transaction` at server/core/iap/adapters/google.ts:186 falls back to the purchase token, as iap.md:341 sets. Run in a temporary copy: `SUBSCRIPTION_STATE_ACTIVE` with one line item and no order gave `verify` `PENDING` with transaction ID `sub-token`, so it no longer reaches the empty transaction ID check of grant order step 4. `lookup_subscription` gave an empty latest transaction ID, which iap.md:341 now requires and subscription apply does not grant. Removing the fallback in that copy failed the tests at server/core/iap/tests/adapters.test.ts:441 and server/core/iap/tests/adapters.test.ts:473 |
| D3 | open | R3-1 | The code and the spec lines still differ. The item left open whether Apple's transaction info holds `appAppleId`: Apple's reference says it does not, so the fix is the spec change the item named |

## must fix

none

## unknown

- The commit range is empty and `## spec changes` is `none`, so only the three debt items were checked. The rest of the module was not reviewed in this round
- No real Apple or Google API was called. Every store response here was written by hand. The Apple evidence comes from Apple's published reference data and library source, not from a real production transaction
- Whether a paid Google subscription can answer with no `latestSuccessfulOrderId` was not confirmed, as in round 2. Such a receipt stays `PENDING` with no grant and no acknowledgement, which is what iap.md:341 requires. The item's question about production behavior therefore remains unanswered, though the code now follows the spec
- D1 was checked on the item's input and the state table of the tests. Whether Apple can answer `ACTIVE` with a refunded transaction as the latest one was not checked
- Tests ran in a temporary copy with `OGW_DEFAULT_DB=sqlite` only, using the harness vitest and the built data of the `open-game-works-core-impl/` checkout at the same commit, not through `ogw core test`. PostgreSQL was not run, because `psql` and `pg_ctl` are not on the PATH of this shell. All 133 tests of `server/core/iap/tests` pass there
- The tests of the modules that depend on `iap` were not run, because no finding says something fails outside these tests
