# review PaymentCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/payment_core/payment_core.gd:529: medium A `recover_purchases` called in a new login session joins a run still going from the previous session and gets that run's discarded result, so the new session's recovery (`BootstrapCore` at `AfterLogin`) handles no transaction. `open-game-works-core/skills/client-core/modules/payment-core.md:144` makes the call share the run in progress, and `:160` ends that run with the failure value, so a store transaction stays undelivered until the next recovery time (a foreground return or a delivery retry). This is a different operation from D9 of the debt list, which covers the same join for `restore_purchases`. Reproduced with a test in a temporary copy, store `APPLE`: `fake_add_unfinished` of `[iap_gems]`, `add_pending(core/RecoverPurchase)`, `recover_purchases`, `log_in` of another user, `recover_purchases` again, then the held response released with `GRANTED`. Both calls returned `false`, `list_unfinished` stayed at 1 call, `RecoverPurchase` at 1 request and `finish` at 0 calls. `test_verification_response_of_an_earlier_login_session_changes_nothing` in `tests/test_recovery.gd` shows that a later `recover_purchases` handles the transaction. This existed before the range. The fix may need a decision on the spec, because the two lines together define this result

## debt

none

## must fix

none

## unknown

- The range changes no file under `client/godot/core/payment_core/` and no file of a client module PaymentCore depends on. `payment-core.md` is unchanged and input `## spec changes` is `none`. The changes that reach PaymentCore are those of `server/core/iap/` (`grant.ts`, `adapters/google.ts`), so the review checked what they change for the client
- Checked: the new `INVALID` of `VerifyPurchase` and `RecoverPurchase` for a `Subscription` whose snapshot is `REVOKED` or `EXPIRED` takes the existing `Invalid` row of both tables (`payment_core.gd:457` and `:694`), which `tests/test_purchase.gd:70` and `tests/test_recovery.gd:18` cover. The changed Google transaction ID is server side: PaymentCore keys transactions on the ID the store adapter gives (`payment_core.gd:772`) and sends the receipt data unchanged. The range's changes to `settings/core-settings.schema.json` have no `PaymentCore` key
- All 74 PaymentCore tests pass, headless, in a temporary copy of the `client/godot/` project of the main checkout, whose `client/godot/` does not differ from the range end. The copy also held the temporary reproduction test above, which is the 75th test in that run. The run had no test host, and its process exited with code 1 although GUT reported every test as passed; the cause of that exit code was not checked. `ogw core test` was not used, so there is no test record, the core static checks did not run, and the browser run did not run
- Whether a real store adapter gives a Google subscription a usable transaction ID was not checked. `ogw-iap-apple` and `ogw-iap-google` are not written yet (`open-game-works-core/skills/client-core/engines/godot.md:54`), so `adapters/plugin_store_adapter.gd` could not run against a real plugin. A real Google response was not called either
- PaymentCore and server `iap` were not run together in this review. The client tests use the fake network with set responses, so the server side of the new `INVALID` rests on `records/review/iap-1.md` and `server/core/iap/tests/subscription.test.ts`, which were read and not run here
- This review's scope is the range, so the module's code was read but was not checked against every behavior of the spec. `client/godot/core/payment_core/dev/` was not read, and of `adapters/plugin_store_adapter.gd` only the header was read. Items D1 to D10 of `records/review-debt/PaymentCore.json` are not in this review's input and were not judged again
- In the reproduction, only store `APPLE` ran. For store `GOOGLE`, the effect on the restore of the new session was read in the code (`payment_core.gd:540` to `:547`) and not run
