# review PaymentCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/payment_core/payment_core.gd:858: medium `claim_daily` has no login session check, so it returns `true` for a claim whose login session ended. This differs from `open-game-works-core/skills/client-core/modules/payment-core.md:160`, which ends an async operation of an ended session with the failure value (`false` in the API table at line 41). Reproduced with a test in a temporary copy: `add_pending(core/ClaimIapDaily)`, `claim_daily` of `[iap_vip]`, `log_in` of another user, then `release_pending` with a success response. `claim_daily` returned `true`. This existed before the range.
- client/godot/core/payment_core/payment_core.gd:434: medium `_run_purchase` does not check the login session after `buy` returns before it returns `Cancelled` (line 435), `Pending` (line 437) or `StoreFailed` (line 440); its first check after `buy` is at line 443, on the `Success` path. `open-game-works-core/skills/client-core/modules/payment-core.md:160` requires the failure value, `Rejected`. Reproduced with a test in a temporary copy using an adapter whose `buy` waits: `purchase` of `[iap_gems]`, `log_in` of another user during `buy`, then `buy` ends. With `Cancelled` the result was `Cancelled`, and with `Pending` it was `Pending`, not `Rejected`. The `StoreFailed` path was read in the code and not run. This existed before the range.
- client/godot/core/payment_core/payment_core.gd:525: medium `recover_purchases` called in a new login session joins a recovery still running from the previous session and returns its discarded result, so `BootstrapCore.AfterLogin` (`client/godot/core/bootstrap_core/bootstrap_core.gd:580`) does no recovery for the new session. The unfinished transactions of that session wait for the next recovery, such as the next foreground return. `open-game-works-core/skills/client-core/modules/payment-core.md:144` (join) and `:160` (discard) together set this result and no document sets a recovery for the new session, so the fix may need a spec change. Reproduced with a test in a temporary copy: one unfinished transaction, `RecoverPurchase` held, `log_in` of another user, a second `recover_purchases`, then the held response is released. The second call returned `false`, `list_unfinished` was called once in total, `RecoverPurchase` was sent once in total, and `finish` was not called. This existed before the range.
- client/godot/core/payment_core/payment_core.gd:601: medium For store `GOOGLE`, the restore of a new login session joins a `restore_purchases` still running from the previous session, and line 546 has already set `_google_restored` to `true`. The joined result is discarded and `list_owned` does not run again in that session, although `open-game-works-core/skills/client-core/modules/payment-core.md:146` has one restore per login session. Reproduced with a test in a temporary copy: first `recover_purchases` of session A, its restore held on `RecoverPurchase`, `log_in` of another user, `recover_purchases` in the new session, the held response released, then `recover_purchases` again. `list_owned` stayed at 1 call and `_google_restored` was `true`. The same join makes a `restore_purchases` that content code calls in the new session wait for the old session's run; that path was read in the code and not run. This existed before the range.

## debt

none

## must fix

none

## unknown

- The range changes one comment of PaymentCore (`client/godot/core/payment_core/payment_core.gd:674`). It changes no behavior and matches `open-game-works-core/skills/client-core/modules/payment-core.md:147` and `open-game-works-core/skills/client-core/modules/network-core.md:106`. The range does not change the code of the modules PaymentCore depends on or the PaymentCore settings keys.
- `ogw core test godot PaymentCore` passed in the native headless run. The browser run (`--web`) was not run.
- The real store plugins were not run. `client/godot/core/payment_core/adapters/plugin_store_adapter.gd` was read only, and Apple and Google store behavior was not checked.
- Server `iap` code was not read. Only its spec was read, because the range does not change it.
- Items D1 to D6 of `records/review-debt/PaymentCore.json` are not in this round's input, so they were not judged and are not written again. The D6 text quotes a "warn log, no screen" wording that `open-game-works-core/skills/client-core/modules/payment-core.md:147` no longer has, so a later review that takes D6 should check it against the current spec.
- The four out of scope reproductions ran against the fake network and the fake store adapter in a temporary copy, and each re-login was a `dev_login` with the earlier request still held. The time window of each case on a real device was not measured.
