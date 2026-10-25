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

- The commit range 2ef5ae8..ceef0b0 changes no file under `client/godot/core/payment_core/` and no PaymentCore spec (`core-spec/PaymentCore.json` unchanged, `## spec changes` is `none`). The review covered the changes in the range that PaymentCore reaches: `client/godot/core/auth_core/auth_core.gd`, `auth_session.gd`, `login_result.gd` (only the added `public_code` field and `get_public_code`; `is_logged_in`, `list_linked_providers`, `is_provider_supported`, `LoginCompletedEvent`, `SessionEndedEvent` that `client/godot/core/payment_core/payment_core.gd` uses are unchanged) and `client/godot/generated/contract/core_contract.gd` (only additions: `public_code` on `BanDetail`, `AuthResult`, `PublicProfileEntry`, and the new `FindUserByPublicCode` messages; no message PaymentCore uses changed). PaymentCore code outside these call paths was not re-read, because it is unchanged and earlier rounds covered it
- PaymentCore Godot tests were not run in this round; the conclusion that the range does not change their behavior comes from reading the diff, not from a test run
- Server `iap` module changes are not part of this target. `server/core/routing/pipeline.ts` and `server/core/storage/*` changed in the range, and their effect on `iap` was not checked
