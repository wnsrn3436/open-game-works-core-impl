# review BootstrapCore round 1

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

- The commit range d4e2728..e5ca441 changes no file under `client/godot/core/bootstrap_core/`. The changes it holds that BootstrapCore reaches were read: `client/godot/core/ui_core/ui_core.gd` (only the new read operation `is_flow_in_progress`, which BootstrapCore does not call; the popup operations that BootstrapCore calls, `prepare`, `open_system_popup`, `close_all_popups`, `get_block_pass_list`, are unchanged), `client/godot/core/screen_effect_core/screen_effect_core.gd` and `client/godot/core/tween_core/tween_core.gd` (BootstrapCore and its tests only call their `init`, `release`, `is_initialized`, which are unchanged; the new `time_basis` parameters have defaults), `client/godot/core/unit_test_core/dev/` (the `PUT /started` start signal of a run; the `start_boot` and `shutdown` calls of `UnitTestCore` are unchanged), the AuthCore client tests (only removed `check_logs` asserts) and the server auth changes (`INTERNAL` with an error log for a `FAILED` transaction; the `CoreError` values that `AuthCore.boot_login` and `issue_deletion_code` receive are unchanged), and the generated core settings (new keys `QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs`; BootstrapCore reads neither). None of these changes causes or reveals a BootstrapCore problem
- The BootstrapCore code outside the places above was not reviewed in full, since the commit range is not `none` and `## spec changes` is `none`
- The core tests of BootstrapCore were not run in this review
