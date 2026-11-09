# update core: iap — lookup result `gone`

## done

- module `iap` (server), commit 5b862041:
  - `adapter.ts`: `StoreAdapter.lookup_subscription` can now return `LookupGone` (`'gone'`). It is not an `AdapterFailure`.
  - `adapters/google.ts`: in the subscription status lookup, HTTP 410 from `purchases.subscriptionsv2` returns `gone`. 404 is still `rejected`, other non-200 answers are still `communication_failure`, and a token endpoint refusal is still `rejected`, since the token endpoint keeps its rule. Receipt verification is unchanged: 400, 404 and 410 give `INVALID` without store transaction info.
  - `dev/adapters/fake.ts`: the controller `set_result('lookup_subscription', 'GONE')` makes the lookup answer `gone` for both fake adapters until the result is set again. A one-time snapshot from `send_fake_subscription_notify` still wins once.
  - `calls.ts`: `lookup_subscription` passes `gone` through without an error log.
  - `index.ts` (`prepare_verify_purchase`): when the step 2 lookup gives `gone`, the result is `INVALID` without store transaction info, as grant order 3 says.
  - `index.ts` (`prepare_sync_subscriptions`): when the lookup gives `gone`, the user's out-of-request change runs `expire_gone_subscription`. If that change fails, the result is `IAP_VERIFY_UNAVAILABLE` with an `error` log.
  - `grant.ts`: new `expire_gone_subscription`. It locks the binding with the grant order 4 lock order and reads the record. If the subscription belongs to another user, it changes nothing and registers that user's change after commit with the new kind `{ kind: 'gone' }`. Otherwise it writes `EXPIRED` and `auto_renew` false, keeps `ends_at` and the product, and recomputes. The after-commit change of another user (`change_other_subscription`) handles kind `gone` the same way the `revoke` kind is handled (re-read, owner check, then expire).
  - `notify.ts`:
    - `REFUND` with `gone` goes on with no snapshot, so step 5 does no subscription apply. For a withdrawn user, the record does not change.
    - `SUBSCRIPTION` with `gone`, also for a withdrawn user, only does `idempotency.claim_notify` in one game transaction (`claim_only`) and returns 200. If that transaction fails, it returns 500.
    - Refund apply of the refund lookup uses the same `refund_work`, so it follows the same `REFUND` rule.
- tests:
  - New `tests/gone.test.ts`, covering:
    - The two new spec `## test` items: iap-google 410 in the lookup of a store notification, and fake `GONE` for `REFUND` and for `SyncSubscriptions`.
    - Grant order `gone` (both 410 and fake `GONE`) is `INVALID` with product ID value 0.
    - `SUBSCRIPTION` with `gone` only claims; the same notification ID later is a duplicate.
    - Withdrawn-user `SUBSCRIPTION` and `REFUND` with `gone`.
    - `SyncSubscriptions` with `gone` for a subscription that moved to another user while the lookup was waiting: the after-commit change sets that user's record to `EXPIRED`.
    - A failed `gone` change is `IAP_VERIFY_UNAVAILABLE`.
  - `tests/adapters.test.ts`: unit tests of google 410/404/500 and the token endpoint, and of the fake `GONE`.
- Last runs on commit 5b862041:
  - `ogw core test server "admin-api auth iap matchmaker notice rating routing testing"` (iap plus `ogw core dependents iap` on the server side): all pass.
  - `ogw code check core`: type check, lint, dependency and secret all pass.
- Changes outside the module's implementation: none outside `server/core/iap/`. Inside the module's tests, `tests/helpers.ts` `without_purchase_time` now passes `gone` through, because the lookup result type grew. No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written.

## spec proposals

- The `### store notification` lookup rule names only `REFUND` and `SUBSCRIPTION`. Refund apply of `### refund lookup` gets `gone` through the shared `REFUND` handling, which matches "the handling that `### store notification` gives a `REFUND` notification". It could be stated there explicitly.
- `## DEV` says the fake result `GONE` is "the lookup result `gone` of `iap-google`". The implementation lets both fake adapters (`iap-apple`, `iap-google`) give it. The spec could say whether the fake `iap-apple` may give it.

## review

none

## unverified

- The real Google Play Developer API answering 410 for an expired purchase token was not checked against the live service. It is tested only with answers made in the test.
- Client dependents (`ogw core dependents iap` client side) were not run. Only server code changed, and the procedure runs only the edited side.
