# review PaymentCore round 1

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

- The commit range 85f6b36d..3a76bdaa changes no file under `client/godot/core/payment_core/` and no PaymentCore settings key. The changes it makes to modules that PaymentCore depends on were read against what PaymentCore uses:
  - AuthCore (`client/godot/core/auth_core/auth_core.gd`): `link_account` still sets `linked_providers` of the session before it returns `SUCCESS`, so the `AuthCore.list_linked_providers` check of the guest warning (`client/godot/core/payment_core/payment_core.gd:474`) sees the link. The new `logout_other_devices` keeps the session and publishes no `LoginCompletedEvent` or `SessionEndedEvent`, so it does not change the login session that PaymentCore tracks
  - TimeCore (`client/godot/core/time_core/time_core.gd`): the DEV frame step changes only the per-frame real increment that feeds `get_real_time`. PaymentCore sets and checks the store call time limit and the delivery retry time with `TimeCore.get_real_time` only (`client/godot/core/payment_core/payment_core.gd:378`, `:947`, `:999`, `:1010`), so both still measure real elapsed time of TimeCore. `make_random_seed` is not used by PaymentCore
  - LogCore: comment-only changes
  - Server `iap` (refund lookup job and its settings `iap.refundLookup*`, `iap.refundRetry*`) and base proto (`LogoutOtherDevices`, MatchmakerFrame fields, `MATCH_JUDGE_STATUS_FORFEIT`): no message or setting that PaymentCore sends, reads or handles changed (`CheckPurchase`, `VerifyPurchase`, `RecoverPurchase`, `SyncSubscriptions`, `ClaimIapDaily`, `IapPurchaseUserState`, `SubscriptionUserState`)
- `ogw core test godot PaymentCore` passed at 3a76bdaa
- The real store adapter `client/godot/core/payment_core/adapters/plugin_store_adapter.gd`, the fake store adapter `client/godot/core/payment_core/dev/adapters/fake_store_adapter.gd` and the PaymentCore test files were not reviewed line by line, because the range does not change them or the definitions they rely on
- The store-side behavior of the real adapters (Apple, Google SDK) cannot be checked on this host
