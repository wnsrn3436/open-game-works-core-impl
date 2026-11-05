# review iap round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/iap/tests/real-adapters.test.ts:167 | The `## test` item of iap.md `## test` (`iap-google`: "a subscription receipt and a subscription status lookup whose `purchases.subscriptionsv2` response has `testPurchase` are a test transaction, and without `testPurchase` they are not") has four cases, and the test checks only two: the receipt with `testPurchase` (payment `GPA.t-1`, made from `subscription_transaction` `test`, server/core/iap/adapters/google.ts:192) and the lookup without it (renewal payment `GPA.t-2`, made from `snapshot_of` `test` through `apply_subscription` server/core/iap/grant.ts:343, google.ts:172). No subscription receipt without `testPurchase` is granted, and no lookup with `testPurchase` makes a payment record (the grant step 2 lookup of the first verify has the same latest transaction ID `GPA.t-1`, so it makes no renewal record). Run path: change google.ts:172 to `test: false` (a lookup is never a test transaction) or google.ts:192 to `test: true` (a subscription receipt is always one); the payments map stays `{GPA.t-1: true, GPA.t-2: false, ...}` and the test passes. No other test reads `testPurchase` (only `adapters.test.ts:351` covers `purchaseType` 0) | Add a subscription receipt without `testPurchase` whose payment record has `test` false, and a sync or notification lookup with `testPurchase` and a new `latestSuccessfulOrderId` whose renewal payment record has `test` true | no | 90 |
| R1-2 | test evidence | medium | server/core/iap/tests/real-adapters.test.ts:447 | iap.md `## DEV` and `## test`: a receipt that does not start with `fake:` is `INVALID` without store transaction info whatever the controller result. The only case of that test without the prefix, `` `gems_apple:fr-1:${token}` ``, has 3 `:`-separated parts, so it is already `INVALID` by the part count check. Run path: remove `parts[0] !== 'fake' \|\|` from `parse_receipt` (server/core/iap/dev/adapters/fake.ts:98); the receipt still splits into 3 parts, `parse_receipt` returns null, the result is `INVALID` with product ID value 0 and no payment record, and the test passes. No other iap test sends a 4 or 5 part receipt without the `fake:` prefix (grep of `iap/tests` and `testing`) | Use a 4 part receipt without the prefix (e.g. `` `notfake:gems_apple:fr-1:${token}` ``) with controller result `VALID` | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The core tests were not run: this checkout has no `server/build/data`, and the `server/build/data` of `open-game-works-core-impl/` predates the test data rows that this range added (`iap_product.bin` older than `test-data/data/tables/iap_product.csv`). The findings come from reading the code and the tests; whether `real-adapters.test.ts` passes on SQLite and PostgreSQL was not checked
- The change of `server/core/iap/adapters/apple.ts:233` (`iap-apple-sandbox` looks up only the sandbox environment, also for a verified `Production` transaction) was checked against iap.md `## settings` and the `## test` item it covers, and against the callers of `lookup_subscription` (`server/core/iap/index.ts:379` with the verified transaction, `index.ts:399` and `server/core/iap/notify.ts:246`, `notify.ts:256` with null); no problem found
- The schema minimum 1 of `iap.verifyTimeoutMs` and `iap.notifyBodyReadTimeoutMs` (`settings/core-settings.schema.json`) matches iap.md `## settings`; the schema check itself belongs to the harness tool and was not run
- Changes of this range in modules that iap calls (`storage` `body` ending a broken transaction `FAILED`, `item-ledger` `insert_history`, `logging` `log_line`) were read only for their effect on iap: iap catches throws only around hooks and transaction calls and returns `INTERNAL` or HTTP 500 for them, so no iap result changes. Those modules themselves were not reviewed
- Code of iap not changed in this range and not reached by the changes (grant order, notifications, transfer, purchase counts, monthly spend) was not reviewed
