# MessageCore review round 1

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

- The commit range `d4e2728f..601904d` changes no MessageCore code or test (`client/godot/core/message_core/`) and no `core-spec/MessageCore.json`. It changes no `MessageCore.*`, `UICore.dimOpacity` or `InputBlockCore.maxDurationMs` settings value: `settings/core-settings.json` and `client/godot/generated/core_settings.json` only add `QACore.captureJpgQuality` and `UnitTestCore.startTimeLimitMs` (and the generated file renames `uiQuality.settleMs` to `uiQuality.settleLimitMs`). No code of `LogCore`, `TimeCore`, `ResourceCore`, `PoolCore`, `LocalizationCore`, `ResolutionCore` or `InputBlockCore` changed in the range
- Of the MessageCore dependencies, the range changes only `TweenCore` and `UICore` code, and both changes are additive: `TweenCore.get_finite_playing_count` (`client/godot/core/tween_core/tween_core.gd:328`) and `UICore.is_flow_in_progress` (`client/godot/core/ui_core/ui_core.gd:654`). MessageCore calls neither. The `TweenCore.play_preset`, `is_playing`, `stop`, `get_preset_kind` and `UICore.get_layer`, `get_block_pass_list` that MessageCore calls (`client/godot/core/message_core/message_core.gd:64`, `client/godot/core/message_core/message_core.gd:251`, `client/godot/core/message_core/message_core.gd:274`, `client/godot/core/message_core/message_core.gd:296`, `client/godot/core/message_core/message_core.gd:304`, `client/godot/core/message_core/message_core.gd:372`, `client/godot/core/message_core/message_core.gd:446`) did not change in the range. The `ScreenEffectCore` time basis change is in a module MessageCore does not depend on
- The `UnitTestCore` change (the pre-run hook now awaits `PUT /started` before the first test, `client/godot/core/unit_test_core/dev/unit_test_core.gd:228`) changes how every core test run starts, not MessageCore behavior or its tests
- The Godot core tests were not run in this review; the code was only read
- Because there is a commit range, the parts of MessageCore that the range does not reach were not audited in full. This does not mean those parts passed
