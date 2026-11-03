# review: SceneCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/scene_core/scene_core.gd:304: medium A node of the new scene whose `process_mode` is `PROCESS_MODE_ALWAYS` receives `_process` from stage 4, which differs from "does not receive the per-frame engine callbacks or the input callbacks" (`open-game-works-core/skills/client-core/modules/scene-core.md`, `### scene`). The only stop is `PROCESS_MODE_DISABLED` on the scene holder, and a node with its own mode does not inherit it. `PROCESS_MODE_ALWAYS` is the documented way for a node to run during pause (`open-game-works-core/skills/client-core/engines/godot.md:312`). Run path: in a scratch copy, `on_prepare` of `scene_b` added such a node and `on_prepare` waited on a gate; after 3 more frames that node had counted 4 `_process` calls while the scene root had counted 0. The engine mapping (`open-game-works-core/skills/client-core/engines/godot.md:294`) says `_process()` does not run under the holder, so that sentence also needs correcting. The code has been this way since before the range
- client/godot/core/scene_core/scene_core.gd:665: medium A top visual node that scene code hides in `on_preload` or `on_prepare` is made visible again at stage 7. `_hide_if_top` remembers it at stage 4, and `_show_hidden` sets `visible` to `true` on every remembered node without knowing that scene code hid it. Run path: in a scratch copy, the `on_prepare` of `scene_b` set `probe.visible = false`, and after `change_scene` returned `true`, `probe.visible` was `true`. `_ready()` is not affected, because it runs before `_hide_tree`. `open-game-works-core/skills/client-core/engines/godot.md:294` writes this restore as it is implemented and `scene-core.md` does not set the case, so the fix needs a spec change. The code has been this way since before the range
- client/godot/core/scene_core/scene_core.gd:346: medium Two unrecoverable failures that `scene-core.md` sets (`### unrecoverable failure`, `## error`), "retry popup cannot be opened" and "transition block cannot be set", have no test. Run path: in a scratch copy, the `_OUTCOME_NOT_OPENED` branch (this line) and both `_block_token == 0` branches (lines 226 and 353) were removed, and all 52 tests of `client/godot/core/scene_core/` still passed. The tests that assert `fatal_count` reach only a missing scene resource, a root that is not the scene base type, a failed root panel prepare and a failed boot `on_prepare`. The code has been this way since before the range

## debt

none

## must fix

none

## unknown

- The commit range changes no file of `client/godot/core/scene_core/`. Its only code changes are `_restore_heading_types` of `client/godot/core/localization_core/localization_core.gd` and tests in `client/godot/core/localization_core/tests/test_font_weight.gd`. A search of `client/godot/core/scene_core/`, `client/godot/core/ui_core/` and `client/godot/core/message_core/` finds no heading type, so no path from the retry popup or the loading screen to the changed code was found. This was checked by search only: a scene or loading screen that uses a heading type across a `LocalizationCore` restart was not run.
- `ogw core test godot SceneCore` passes on the target commit, and that result was reused from a passing result of the same key, not run again. `--web` was not run.
- Runs in this round used a scratch copy of the Godot project outside the checkout, with a stub test host. The two runs ended with exit code 1, and the cause was not checked. The first run reports all 3 probe tests passed and the second reports all 52 tests passed, and the out of scope items read only the printed probe values and that test count.
- `scene_core.gd`, `scene_base.gd`, `loading_screen_base.gd` and the three wait classes were read in full. Of the tests, `test_lifecycle.gd`, `test_retry_popup.gd`, `test_failure.gd`, `test_scene_holder.gd` and `test_panels.gd` were read in full. `test_transition.gd` and `test_loading_screen.gd` were checked by test name only, so whether their asserts check the result of each `## test` item was not checked.
- Of the dependency modules, only the paths `SceneCore` calls in `UICore` (`reset_panel_stack`, `set_panel_lock`, `open_system_popup`, `close_popup`, `close_all_popups`), `InputBlockCore.block` and `ResourceCore.preload_resources` were read. `PoolCore.prefill`, `MessageCore.close_black_box`, `ScreenEffectCore.clear_owner` and `SafeAreaRoot` were not read.
- A `Window` node or a `SubViewport` under the scene holder, and an audio player with autoplay under it, were not run.
