# CutsceneCore review round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `client/godot/core/cutscene_core/tests/test_focus.gd:74` sets the keyboard device, calls `InputCore.set_keys(&"cutscene_advance", ["Space"])`, starts the key focus mode with Down, and checks one click and one line step for the Enter accept input (`:87`, `:88`) and one more for the Space accept input (`:92`, `:93`). The release comes in a later frame (`press_and_later_release_key`, `:61`), so `_advance_click_is_press` (`client/godot/core/cutscene_core/cutscene_core.gd:1626`) reaches the key path of `_is_advance_binding`. Restored defect: in a temporary core worktree of HEAD, `cutscene_core.gd:1658` `if input_name.is_empty():` was changed to `if input_name.is_empty() or not pad:`, so that every key gives `false`. `ogw core test godot CutsceneCore --file client/godot/core/cutscene_core/tests/test_focus.gd` then failed in that test with "[0] expected to equal [3]: the Space press and its accept click are one advance input". On the unchanged checkout the same file passes |
| R2-1 | fixed | `init` now checks `_MAX_KEYS_KEY` and `_MAX_PAD_BUTTONS_KEY` with `CoreSettings.has_int` together with the other `## settings` integer keys, and fails with an error log (`client/godot/core/cutscene_core/cutscene_core.gd:166`-`:171`). It reads both keys and the input map event count of `cutscene_advance` once and sizes `_key_buffer` and `_pad_buffer` to setting + default binding size (`:186`-`:188`), which matches `open-game-works-core/skills/client-core/modules/cutscene-core.md:207`, `:208`. No failure path of `init` comes after the resize (the `UICore` layer check is at `:175`), so a failed `init` leaves both buffers empty. `_reset_module` sets fresh empty arrays (`:392`, `:393`). `_is_advance_binding` uses the buffers and reads no `CoreSettings` on a click (`:1660`). `InputCore` never changes the input map (it only reads it in `_read_input_map`, `client/godot/core/input_core/input_core.gd:1951`, `:1964`), so the count read in `init` equals the count the old click-time code read. `get_keys` and `get_pad_buttons` fill at most `buffer.size()` entries (`input_core.gd:1766`), and the loop reads only `count` entries, so the old entries left in a shared buffer are never read. Tests: `tests/test_lifecycle.gd:140` and `:153`. Restored defect: in a temporary core worktree of HEAD, `_MAX_KEYS_KEY, _MAX_PAD_BUTTONS_KEY` were removed from the `init` key list (`cutscene_core.gd:167`). `test_init_fails_when_an_input_core_binding_size_setting_is_missing_or_not_an_integer` then failed ("InputCore.maxKeysPerAction; [0] expected to equal [1]" and the `assert_initial_state` asserts). The whole `ogw core test godot CutsceneCore` passes on the unchanged checkout |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | fixed | none | Same as R2-1: `client/godot/core/cutscene_core/cutscene_core.gd:166`-`:171` checks both `InputCore` keys in `init`, `:186`-`:188` reads them in `init`, and `_is_advance_binding` (`:1660`) no longer calls `CoreSettings.get_int` on an advance button click |

## must fix

none

## unknown

- Tests run: `ogw core test godot CutsceneCore` on the checkout under review (pass), and the two restored-defect runs above in a temporary core worktree of HEAD, which was removed afterwards. `--web` runs and the native render pass of `QACore` were not run
- The case where an `InputCore` binding size key is fully missing from core settings was not run. Only a value of another type (`UnitTestCore.set_invalid_test_settings`) was tested. By reading the code, both cases go through the same `CoreSettings.has_int` check at `client/godot/core/cutscene_core/cutscene_core.gd:169`
- The commit range also changes `UnitTestCore.require_platform`, which now returns whether the test goes on, and a failure in a skipped test now makes it fail (`client/godot/core/unit_test_core/dev/unit_test_core.gd:478`, `:1531`). `client/godot/core/cutscene_core/tests/test_page_audio_suspended.gd:63` ignores the return value and returns after `OS.get_name() != "Web"`, with every caller returning on a null call (`:20`, `:38`). The result is the same as using the return value. The `web` run of that file was not run in this round
- As in the previous rounds, the default binding size is the count of all `cutscene_advance` input map events, keys and gamepad inputs together. With that count, a buffer is never smaller than what `get_keys` or `get_pad_buttons` can fill
