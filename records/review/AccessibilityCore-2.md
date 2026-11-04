# review AccessibilityCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/core/accessibility_core/tests/test_saved_settings.gd:47` sets `LocalizationCore` back to 1000 after `AccessibilityCore.release`, asserts 1000 before `apply_saved_settings` (line 51) and 1500 after it (line 54); new `test_saved_text_scale_reaches_localization_core_at_apply_saved_settings` (line 93) saves 1250 before `init`. Restored the defect in a temporary detached worktree of HEAD (`git worktree add --detach`, removed afterwards) by deleting the line `_apply_text_scale()` from `apply_saved_settings` (`client/godot/core/accessibility_core/accessibility_core.gd:162`); `ogw core test godot AccessibilityCore --file client/godot/core/accessibility_core/tests/test_saved_settings.gd` failed: `test_set_values_come_back_after_release_init_and_apply_saved_settings: [1000] expected to equal [1500]` and `test_saved_text_scale_reaches_localization_core_at_apply_saved_settings: [1000] expected to equal [1250]` |
| R1-2 | open | Spec changes are `none`: `open-game-works-core/skills/client-core/modules/accessibility-core.md:83` still says the values passed to `LocalizationCore` are reverted by the `release` of that module, and line 142 still says that after `set_test_text_scale` "On `release` it returns to the saved value", without a `## test` item. The implementation now passes a text scale in `release` (`client/godot/core/accessibility_core/accessibility_core.gd:126-127`) only after a test value, which line 83 does not state. "Saved value" is also still not set for a `set_test_text_scale` before `apply_saved_settings`: with `AccessibilityCore.text_scale` 1250 in the device file, `init`, `set_test_text_scale(1500)`, `release` puts `_settings.text_scale_permille` (the default 1000, line 117) on `LocalizationCore`, not the 1250 in the device file. The fix report leaves this as a spec proposal |
| R1-3 | fixed | `release` re-applies `_settings.text_scale_permille` when `_test_text_scale_applied` (`client/godot/core/accessibility_core/accessibility_core.gd:126-127`), set by `client/godot/core/accessibility_core/dev/accessibility_core_dev.gd:18` and cleared in `_reset_state` (line 546), so line 142 of the spec holds after `apply_saved_settings`. Restored the defect in the temporary worktree by deleting lines 126-127; `ogw core test godot AccessibilityCore --file client/godot/core/accessibility_core/tests/test_text_scale.gd` failed: `test_release_after_set_test_text_scale_puts_the_saved_text_scale_back: [1500] expected to equal [1250]: the saved value` |
| R1-4 | fixed | `init` reads `_rendering_method()` (`client/godot/core/accessibility_core/accessibility_core.gd:113`, `:339-342`), which `_test_rendering_method` replaces in core tests (a `_` static of the module class, allowed for core tests by `open-game-works-core/skills/client-core/engines/godot.md:157`). Restored the defect in the temporary worktree twice: (a) replaced the warn at line 116 with `pass`: `test_color_filter.gd::test_engine_without_a_full_screen_shader_applies_no_filter_and_warns_once_per_init` failed with `[0] expected to equal [1]: warn at init` and `warn again at the next init`; (b) made `_make_filter` run regardless of the rendering method (warn kept): the same test failed with `Expected [AccessibilityColorFilter:<ColorRect#...>] to be NULL` and `no filter on the layer` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: both text scale tests of `test_saved_settings.gd` fail when `_apply_text_scale()` is removed from `apply_saved_settings` (mutation run above) |
| D2 | open | R1-2 | `accessibility-core.md:83` and `:142` are unchanged and still give different text scales right after `release`; see R1-2 |
| D3 | fixed | none | Same as R1-4: the new test fails when the warn is removed and when the filter is made on an unsupported rendering method (mutation runs above) |
| D4 | fixed | none | Same as R1-3: `release` puts the saved text scale back after `set_test_text_scale`, and `test_release_after_set_test_text_scale_puts_the_saved_text_scale_back` fails without it (mutation run above) |

## must fix

none

## unknown

- The mutation runs used `ogw core test godot AccessibilityCore --file <test file>` (headless pass only) in a temporary detached worktree of HEAD, removed afterwards. No unmutated baseline run was made; the only failing asserts in each mutated run were the ones tied to the restored defect, and the fix report states the full `ogw core test godot` and `--web` runs passed
- The render pass (`test_render_color_filter.gd`) and the browser run (`--web`) were not run by this review
- The changes of the commit range outside `client/godot/core/accessibility_core/` (other modules, server core, test data) were checked only for references to `AccessibilityCore` / `AccessibilityCoreDev` (none changed); their own behavior is outside this target
- The behavior on a real engine whose rendering method is outside `forward_plus`, `mobile`, `gl_compatibility` was checked only through `_test_rendering_method`
