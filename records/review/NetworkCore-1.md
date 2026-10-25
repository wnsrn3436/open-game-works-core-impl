# NetworkCore review round 1

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

- The commit range d4e2728fef95f1bcf36a696d7d54ff290185b73a..abace1e554a6c1cd2f71fc1edb07c752e2eaeb0c changes no NetworkCore code, test or spec: `git diff --stat` of the range on `client/godot/core/network_core/` and `core-spec/NetworkCore.json` is empty, and `## spec changes` is `none`. Of the modules in `## dependency` of the NetworkCore spec (`LogCore`, `EventCore`, `TimeCore`, `DataCore`, `UserStateCore`, `InputBlockCore`, `UICore`, `MessageCore`) and its server dependencies (`session`, `logging`), only `UICore` changes, in `client/godot/core/ui_core/ui_core.gd` and its test `client/godot/core/ui_core/tests/test_popup.gd`
- The `UICore` change only adds the read-only operation `is_flow_in_progress` (`client/godot/core/ui_core/ui_core.gd:654`). It changes no state and no other operation. Its spec user is `QACore` (`skills/client-core/modules/ui-core.md:50` in the harness repo), and NetworkCore code and tests do not call it. NetworkCore calls only `UICore.show_loading_icon`, `hide_loading_icon`, `get_block_pass_list`, `open_system_popup` and `is_initialized` (`client/godot/core/network_core/network_core.gd:310`, `:710`, `:736`, `:749`, `:1060`, `:1085`), and the range does not change them
- The test support `client/godot/core/network_core/tests/support/network_test_case.gd` extends `UnitTestCase` (`client/godot/core/unit_test_core/dev/unit_test_case.gd`, not changed in the range) and calls `TweenCore.init`. The range adds `TweenCore.get_finite_playing_count` and changes `ScreenEffectCore` (not called by NetworkCore or its test support), the `UnitTestCore` run start (`PUT /started` in `_begin_run` and `_send_init_failure`, outside the per-test setup), and the core settings files (new keys `QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs`, and `uiQuality.settleMs` renamed to `uiQuality.settleLimitMs`). No NetworkCore setting key changes, and NetworkCore code does not read `uiQuality`. Judged from the code only
- The NetworkCore core tests were not run in this review: the core project has no `client/godot/addons/` here, which `ogw core test` fills
- NetworkCore code and tests were not reviewed line by line for problems outside the range, because they are not changed in the range and are not reached by the changes
