# review UICore round 1

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

- The range 9b1e14b5..b5f42536 changes no file under client/godot/core/ui_core/ and does not change core-spec/UICore.json. Of the dependency modules of UICore, only LocalizationCore changes: `list_languages` takes `PackedInt32Array` (client/godot/core/localization_core/localization_core.gd:304). UICore calls only `LocalizationCore.format` and `LocalizationCore.get_text` (client/godot/core/ui_core/ui_core.gd:1808, :1810, :1813), and neither changes
- The other client changes of the range were read: bootstrap_core tests, message_core (`show_black_box` signature), payment_core (a comment), qa_core (settings reads removed) and generated settings. No code or test under client/godot/core/ui_core/ refers to `list_languages`, `show_black_box`, `uiCheckScreens`, `uiQuality`, `gamepadSupported`, `supportedLanguages` or `AccessibilityCore.textScales`. The hunks of the settings files add or move only coupon, matchmaker, routing, `uiCheckScreens`, `uiQuality` and `gamepadSupported` keys. The `UICore.*` keys are unchanged (client/godot/generated/core_settings.json:329 to :336), and so are `TimeCore.reachMarginMs` and `InputBlockCore.maxDurationMs`
- The data tool changes of the range (tools/data-tool/src/corespec.ts, tools/data-tool/src/godotgen.ts, tools/data-tool/src/checks/NoticeCore.ts) were read. Non-test files directly under client/godot/core/ui_core/ do not refer to `GameData`. The effect of those changes on the generated `ReservedSound` that `UICore.prepare` uses (client/godot/core/ui_core/ui_core.gd:270) was not traced separately, and only the core test below covers it
- `ogw core test godot UICore` reported `pass`. The output does not say whether the module ran again or a kept passing result was used. Tests of the modules that depend on UICore were not run, and the Web run (`ogw core test godot --web`) was not run
- Because the range does not reach UICore, the rest of client/godot/core/ui_core/ and its tests were not reviewed against the spec in this round, so this file does not state that they match it. Only the parts named above were read
- records/review-debt/UICore.json holds D1 and records/review-debt/spec-UICore.json also exists. This round's input `## debt` and `## must fix` are `none`, so these items were not judged and stay in the lists. They were not reproduced in this round
- records/review/MessageCore-1.md:29 records one failure of `UICore.prepare` in a direct MessageCore run under a time limit, and records/review/MessageCore-2.md:30 records that it did not appear in 6 later runs. It was not reproduced in this round and its cause was not checked, so it is not written as a problem
