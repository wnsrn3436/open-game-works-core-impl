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

- The commit range d4e2728..2849c47 changes no file under `client/godot/core/payment_core/`, no file under `server/core/iap/` and not `core-spec/PaymentCore.json`, and `## spec changes` is `none`. The review covered the changes in the range that PaymentCore reaches: `client/godot/core/ui_core/ui_core.gd` (only the added `is_flow_in_progress`; `open_system_popup`, which `client/godot/core/payment_core/payment_core.gd:496` calls, is unchanged), the removed `UnitTestCore.check_logs` asserts in `client/godot/core/auth_core/tests/` (AuthCore tests only; AuthCore code is unchanged), `client/godot/core/unit_test_core/dev/unit_test_core.gd` and `gut_pre_run.gd` (the added `PUT /started` start signal of the test run; `check_logs` and the test case support that PaymentCore tests use are unchanged), and `client/godot/generated/core_settings.json` and `settings/core-settings.json` (new `QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs` and the rename of `uiQuality.settleMs` to `settleLimitMs`; PaymentCore code and tests read none of them). PaymentCore code outside these call paths was not re-read, because it is unchanged in the range
- PaymentCore Godot tests were not run in this round; the conclusion that the range does not change their behavior comes from reading the diff, not from a test run
- `server/core/auth/login.ts`, `server/core/auth/deletion.ts` and `server/core/auth/dev/index.ts` changed in the range (error logs and the failure results of token-less requests and of the web account deletion). They are server `auth`, not this client target, and their effect on the server `iap` module was not checked
