# review iap round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `server/core/iap/tests/real-adapters.test.ts:167` now also has user `b`: a subscription receipt whose `subscriptionsv2` answer has no `testPurchase` (`GPA.u-1`, expected `test` false), then a subscription sync whose lookup has `testPurchase` and a new `latestSuccessfulOrderId` (`GPA.u-2`, expected `test` true). Restored in a temporary copy made by `git archive HEAD` outside the checkout (core test data build of the `open-game-works-core-impl/` main checkout at the same commit dc91902), run with vitest on SQLite: (1) `server/core/iap/adapters/google.ts:172` `test: is_test_purchase(json)` changed to `test: false` makes that test fail with `expected { 'GPA.u-1': false, 'GPA.u-2': false } to deeply equal { 'GPA.u-1': false, 'GPA.u-2': true }`; (2) `server/core/iap/adapters/google.ts:192` changed to `test: true` makes it fail with `expected { 'GPA.u-1': true, 'GPA.u-2': true } to deeply equal { 'GPA.u-1': false, 'GPA.u-2': true }`. With the code restored, all 16 tests of the file pass |
| R1-2 | fixed | `server/core/iap/tests/real-adapters.test.ts:457` now sends `` `notfake:gems_apple:fr-1:${token}` `` (4 parts) with controller result `VALID`. In the same temporary copy, removing `parts[0] !== 'fake' \|\| ` from `server/core/iap/dev/adapters/fake.ts:98` makes the test `a receipt without fake:, of 3 parts or of 6 parts is INVALID ...` fail with `expected { status: 1, product_id: 1745068754 } to deeply equal { status: 3, product_id: +0 }` (SQLite). With the code restored it passes |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The defect restorations and the test file were run only on SQLite (`OGW_DEFAULT_DB=sqlite`, no `OGW_POSTGRESQL`), with vitest started directly in a temporary copy rather than through `ogw core test`. The PostgreSQL run was not done by this review; the core agent report says both mutations failed and the restored code passed on SQLite and PostgreSQL
- In this range the only change to the iap module was `server/core/iap/tests/real-adapters.test.ts`. Changes of this range in modules that iap uses or that call iap were read only for their effect on iap: `mailbox` `mail_input.ts` now treats only `undefined` (not `null`) as an omitted field and accepts a `number` `expire_ms`; iap calls `mailbox.grant_or_mail` with an `args` array `[]` (`server/core/iap/grant.ts:114`, `server/core/iap/index.ts:424`) and `cancel_mail_by_once_key`, so no iap result changes. `routing` `http.ts` / `pipeline.ts` change how the client IP is made; the `client_ip` input of iap `POST /iap/notify/<store>` (`server/core/iap/index.ts:109`) is not used by `handle_notify` (`server/core/iap/index.ts:491`). Those modules themselves were not reviewed
- The `settings/core-settings.schema.json` change of this range (`routing.bodyReadTimeoutMs` minimum 1) is a routing key and was not checked against iap
- iap code not changed in this range was not reviewed again
