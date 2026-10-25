# review VirtualPadCore round 1

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

- The commit range d4e2728..2e43cbf changes, on the client side, only AuthCore tests, ScreenEffectCore, TweenCore, UICore, UnitTestCore (`client/godot/core/auth_core/tests/`, `client/godot/core/screen_effect_core/`, `client/godot/core/tween_core/`, `client/godot/core/ui_core/`, `client/godot/core/unit_test_core/`), the generated settings (`client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json`), `core-spec/` files of other modules, server code, settings and `records/`. No file of `client/godot/core/virtual_pad_core/` or `core-spec/VirtualPadCore.json` is in the range
- Of UICore, VirtualPadCore calls only `UICore.get_layer` (`client/godot/core/virtual_pad_core/virtual_pad_core.gd:85`) and `UICore.get_open_popup_count` (`virtual_pad_core.gd:417`, `virtual_pad_core.gd:450`), and its tests also call `UICore.init`, `UICore.prepare`, `UICore.release`, `UICore.open_popup` and `UICore.close_all_popups`. The range changes `client/godot/core/ui_core/ui_core.gd` only by adding `is_flow_in_progress` (`client/godot/core/ui_core/ui_core.gd:654`), which reads UICore state and changes none, so none of those calls changes. The VirtualPadCore spec and code do not reference `is_flow_in_progress`
- The tests of VirtualPadCore use `UnitTestCore.check_logs`, `set_test_settings`, `latch_event` and `wait_frames` (`client/godot/core/virtual_pad_core/tests/support/virtual_pad_test_case.gd:89`, `:294`, `:298`, `tests/test_user_settings.gd:124`). The range changes UnitTestCore only in the run start (`_begin_run` now awaits `_send_started`, which sends `PUT /started`, `client/godot/core/unit_test_core/dev/unit_test_core.gd:943`) and not those operations. The TweenCore change only adds `get_finite_playing_count` and the ScreenEffectCore change adds a `time_basis` input with a default; VirtualPadCore code does not call either module, and the test support only calls `TweenCore.init` and `TweenCore.release`, which are not changed
- The settings changes (`QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs`, `uiQuality.settleMs` renamed to `uiQuality.settleLimitMs`) are not read by VirtualPadCore code or tests: grep of `client/godot/core/virtual_pad_core/` for `uiQuality`, `settle`, `captureJpgQuality` and `startTimeLimitMs` has no match. `VirtualPadCore.deadZonePermille` and `VirtualPadCore.sensitivityPermille` are unchanged
- The checks above were done by reading only; the VirtualPadCore tests were not run in this review
- The VirtualPadCore code and tests outside the range were not reviewed, because the range does not change them or the behavior of the code they call, input `## spec changes` is `none`, and input `## debt` and `## must fix` are `none`
- The changes of the other modules were read only for their effect on VirtualPadCore; they were not reviewed against their own specs
