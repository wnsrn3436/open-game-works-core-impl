# review iap round 2

## findings

none

## previous

none

## out of scope

- server/core/iap/grant.ts:336: medium Subscription apply grants a new subscription period for a snapshot whose state is `REVOKED`, so a refunded period is paid out. This is D1 of `records/review-debt/iap.json`, which is not in the input `## debt`. The line did not change in the range and was read again, not run again. Round 1 reproduced it in a temporary copy (`records/review/iap-1.md`). It needs a spec change at `open-game-works-core/skills/server-core/modules/iap.md:211`
- server/core/iap/adapters/google.ts:135: medium `latest_order_of` has no fallback to the purchase token, so a subscription without an order ID gets an empty transaction ID, while `open-game-works-core/skills/server-core/modules/iap.md:341` sets the purchase token. This is D2 of `records/review-debt/iap.json`, which is not in the input `## debt`. The line did not change in the range and was read again, not run again. Round 1 reproduced it in a temporary copy. Whether Google returns an active subscription without an order ID in production was not checked
- server/core/iap/adapters/apple.ts:185: medium `verification_of` compares only `bundleId`, while `open-game-works-core/skills/server-core/modules/iap.md:324` and `iap.md:340` also require `INVALID` when `appAppleId` of production store transaction info differs from `iapApple.appAppleId`. `app_apple_id` is compared only at `server/core/iap/adapters/apple.ts:193`, for notifications. This is D3 of `records/review-debt/iap.json`, which is not in the input `## debt`. The line did not change in the range and was read again, not run again. Round 1 reproduced it in a temporary copy. Whether Apple's transaction info holds `appAppleId` was not checked; when it does not, the fix is to change those spec lines

## debt

none

## must fix

| id | result | finding | evidence |
|---|---|---|---|
| M1 | fixed | none | `bind_tokenless` now returns false when there is no binding and the receipt is not a device receipt (`server/core/iap/grant.ts:635`), and `judge` then gives `INVALID`. `open-game-works-core/skills/server-core/modules/iap.md:132` has the same condition (harness commit c9290bd). `bind_tokenless` has one caller and is the only place in `server/core/iap/` that binds a store transaction without an account token before a grant. The other routes to another user's store transaction require a device receipt too (`transfer_allowed`, `grant.ts:600`). The run was on SQLite in a temporary clone at 7d95d74. With the M1 input (`VALID`, `test` false, `device_receipt` false, no account token), `VerifyPurchase` and `RecoverPurchase` of `gems_apple` gave `INVALID`, balance 0 and no binding. `{result: 'PENDING', device_receipt: false}` gave `INVALID` and no binding, and `vip_apple` gave `INVALID`, no binding and no subscription row. Another user who then sent the first transaction with a device receipt got `GRANTED` and the payment record, and a repeat by the first sender did not grant. Those cases were a temporary test that is not in the checkout. Removing line 635 in another clone made the test at `server/core/iap/tests/transfer.test.ts:322` fail (`expected 1 to be 3`). Moving line 635 above the binding check in a third clone made the test at `transfer.test.ts:342` fail (`expected 3 to be 1`). All 126 tests of the 9 iap test files, including the temporary test, passed on the unchanged code in that clone |

## unknown

- The real `iap-apple` adapter was not run through grant order. The fake adapter's `device_receipt` value stood in for it. That `iap-apple` returns a decimal transaction ID and a JWS that fails certificate chain verification as not device receipts rests on `server/core/iap/adapters/apple.ts:169` and the tests in `server/core/iap/tests/adapters.test.ts`, which passed
- The client plugin `ogw-iap-apple` is not in `client/godot/plugins/`, so what it sends as receipt data was not checked. `open-game-works-core/skills/server-core/modules/iap.md` allows a JWS or a decimal transaction ID, and `open-game-works-core/skills/client-core/modules/payment-core.md` was searched for the plugin and its adapter and does not state the receipt form in the lines found. If that plugin sends the decimal form, a real buyer of an Apple store transaction without an account token and without a binding gets `INVALID`, and `INVALID` ends the store transaction (`iap.md:62`). No plugin exists to show this, so it is not a finding
- `open-game-works-core/skills/server-core/modules/iap.md` `## test` has no line for the new condition, although the input `## spec changes` is `none` and the tests above cover it. The fix report `records/1793738895882-update-core-mw15tq1642a069.md` proposes that line and also an optional `security` log for this `INVALID`. The spec does not require such a log, so its absence was not judged a defect. Both are for the lead agent to decide
- The clone runs of the temporary test and of the two restored defects were on SQLite only, with `server/build/data` of the main checkout, using vitest directly. The PostgreSQL run covered only `server/core/iap/tests/transfer.test.ts` on unchanged code. Three `ogw core test server iap --file` jobs (`iap pass`) were started from clones in the scratchpad, but `resolveCoreImpl` ran them on the main checkout at 7d95d74, because the clones were not under `worktrees/_core/`. They therefore say nothing about the clones. Each should have run that file on SQLite and PostgreSQL on 7d95d74, which is the reviewed code, but the output shows only module results. The main checkout stayed clean at 7d95d74 after them
- The modules that depend on iap were not run in this round. The fix report says they passed, and the range changes nothing else under `server/core/`
- How easily an attacker can learn a transaction ID was not measured. With a device receipt required it no longer decides M1, but a JWS receipt that leaks from the buyer's device would still bind, and that was not examined
- Concurrent sends of a store transaction without an account token were covered only by the existing test `two users with social links sending the same token-less store transaction at once`, which uses the fake adapter's default device receipt. D1, D2 and D3 were read and not run again
