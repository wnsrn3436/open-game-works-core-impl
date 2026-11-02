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

- The commit range d4c3ae7..2268223 changes no file under `client/godot/core/payment_core/`, no file under `server/core/iap/`, no file under `proto/`, `settings/` or `test-data/`, and not `core-spec/PaymentCore.json`, and `## spec changes` is `none`. The review covered the changes in the range that PaymentCore reaches: `client/godot/core/ui_core/ui_core.gd` (only the new read-only `is_dimmed`, `_is_dimmed` and `_dim_above`; `open_system_popup` at `client/godot/core/ui_core/ui_core.gd:505`, which `client/godot/core/payment_core/payment_core.gd:496` calls, and the dim and popup state it changes are not in the diff; PaymentCore code and tests do not call `is_dimmed`), `client/godot/core/qa_core/dev/qa_query.gd` and the UICore and QACore test files and test prefabs (PaymentCore does not use QACore and `client/godot/core/payment_core/tests/support/payment_test_case.gd` does not use those prefabs), and `client/godot/generated/core_settings.json` (only `uiQuality.maxFlatShare` is removed; `client/godot/core/payment_core/payment_core.gd:195` reads `PaymentCore.storeCallTimeoutMs`, `PaymentCore.deliveryRetryDelayMs` and `TimeCore.reachMarginMs`, which the range does not change). PaymentCore code outside these call paths was not re-read, because it is unchanged in the range
- PaymentCore Godot tests were not run in this round, because `ogw core test` runs `ogw core spec` and the core project import, which write generated files into this checkout. The conclusion that the range does not change their behavior comes from reading the diff. `records/1793645028102-update-core-mvzlxt6u5be5ef.md` reports, for the dependents of UICore, which include PaymentCore, that `ogw core test godot --web` passed 25 of 25 and that `ogw core test godot` passed 22 and skipped `AccessibilityCore`, `NativeUiCore` and `QACore`, and `git diff c18626d 2268223` outside `records/` is empty, but this review did not repeat those runs
- The new `UICore.is_dimmed` and `QACore` `list_ui` `dimmed` behavior and their tests were read only for their effect on PaymentCore. They were not checked against `## test` of the UICore and QACore specs, because they are not this target
