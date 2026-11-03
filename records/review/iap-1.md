# review iap round 1

## findings

none

## previous

none

## out of scope

- server/core/iap/grant.ts:634: critical A user can claim another person's store transaction that has no account token by sending only its transaction ID. `bind_tokenless` binds and grants to the first sender without looking at `device_receipt`, and `open-game-works-core/skills/server-core/modules/iap.md:132` sets no such condition, although `iap.md:176` requires a device receipt for ownership transfer for this reason, so this is solved by changing the spec together with the code. Run path for `iap-apple`, read in the code and not run against that adapter: receipt `<decimal transaction ID>` passes `apple_transaction_id` (`server/core/iap/adapters/apple.ts:72`), `is_device_receipt` returns `false`, a transaction without `appAccountToken` has an empty `account_token`, and `judge` reaches `bind_tokenless`. Run in a temporary copy with the fake adapter: `set_result('verify', {result: 'VALID', test: false, device_receipt: false})`, then `VerifyPurchase` of `fake:gems_apple:tl-1:` gave `GRANTED`, balance 100 and a `GRANTED` payment record with `test` false. The real buyer of a `Consumable` then gets `ALREADY_GRANTED` with nothing (read in the code, grant.ts:603). The attacker has to know the ID of such a transaction (e.g. an offer code redemption) within `iap.withdrawnRecordRetentionMs` of purchase, and how easily an ID can be learned was not measured. The fix direction is to require a device receipt in this exception
- server/core/iap/grant.ts:336: medium Subscription apply grants a new subscription period for a snapshot whose state is `REVOKED`, so a refunded period is paid out. It follows `open-game-works-core/skills/server-core/modules/iap.md:211`, which does not look at the snapshot state, so it needs a spec change. Reproduced in a temporary copy: `sub-1` granted (balance 30), `send_fake_refund` of `sub-2` with no payment record gave HTTP 200 without handling (`iap.md:247`), then `send_fake_subscription_notify` of `sub-1` with `state` `REVOKED` and `latest_transaction_id` `sub-2` gave HTTP 200, balance 60 and a `GRANTED` payment record of `sub-2`. The store does not resend the answered `REFUND`, so nothing revokes that grant, and the record counts in monthly spend. It needs a lost or out-of-order renewal notification
- server/core/iap/adapters/google.ts:135: medium A subscription without an order ID gets an empty transaction ID instead of the purchase token that `open-game-works-core/skills/server-core/modules/iap.md:341` sets for a store transaction without `orderId`. `latest_order_of` has no fallback, while `product_transaction` has one (`text_of(json.orderId) || r.token`). Reproduced in a temporary copy: a `subscriptionsv2` answer of `SUBSCRIPTION_STATE_ACTIVE` with no `latestOrderId` and no `latestSuccessfulOrderId` made `verify` return `VALID` with `transaction_id` `''` and `lookup_subscription` return `latest_transaction_id` `''`. Grant order step 4 judges an empty transaction ID `INVALID` with no payment record (grant.ts:563, read in the code), and the client ends that store transaction, so that paid subscription is not granted. `server/core/iap/tests/adapters.test.ts` has no such case. Whether Google returns an active subscription without an order ID in production was not checked
- server/core/iap/adapters/apple.ts:185: medium `verification_of` compares only `bundleId`, while `open-game-works-core/skills/server-core/modules/iap.md:324` and `iap.md:340` also require the receipt verification result `INVALID` when `appAppleId` of production store transaction info differs from `iapApple.appAppleId`. Reproduced in a temporary copy: signed transaction info with `environment` `Production` and `appAppleId` 9 on an adapter with `app_apple_id` 1234 gave `VALID`. Only the notification check has this comparison and a test (`server/core/iap/tests/adapters.test.ts:316`). `bundleId` is still checked, so this was not shown to let a transaction of another app through. Whether Apple's transaction info holds `appAppleId` at all was not checked; when it does not, the fix is to change those spec lines, not the code

## debt

none

## must fix

none

## unknown

- The range changes no file under `server/core/iap/` and none of its dependency modules. What it does change that could reach iap was read: `server/core/Dockerfile` (iap production code imports nothing from `dev/` or `tests/` at runtime), `settings/` (no `iap.*` key), `core-spec/` (`core-spec/iap.json` unchanged), `tools/data-tool/src/corespec.ts` and `client/godot/core/payment_core/payment_core.gd` (a comment only). No finding comes from them
- All iap production code was read beyond what the range requires, because the module has no earlier review file in `records/review/`. Its tests were read only in part, so each `## test` item of the spec was not matched to a test, and `test evidence` was not judged for the whole module
- The iap tests ran on SQLite only, in a temporary copy of this checkout: 9 files and 123 tests passed. The PostgreSQL run was not done, so behavior that depends on row locks under real concurrency was not observed. `ogw core test` was not used, because it can commit generated files in the checkout
- That run used `server/build/data` of the main checkout at 4fdd5bc, because this checkout has no build. 4fdd5bc differs from the reviewed HEAD 07923ff only in `records/`
- `server/core/iap/adapters/apple.ts` and `google.ts` were run only against the recorded answers of the tests, not against the real store APIs. Store API behavior was not checked against store documentation
- `server/core/iap/dev/` was not read beyond what the tests use. The callers `routing`, `admin-api` and `auth` were read only where they register or call iap, and the implementation of `mailbox`, `item-ledger`, `storage` and `idempotency` was read only through their specs
- `iap.md:244` with a concurrent withdrawal and `iap.md:422` concurrent grants were not reproduced beyond the existing tests
