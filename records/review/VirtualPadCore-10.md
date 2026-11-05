# VirtualPadCore review round 10

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R10-1 | test evidence | medium | client/godot/core/virtual_pad_core/tests/test_memory.gd:72 | The two tests added for R9-1 do not fail when the R9-1 defect (growing `_consumed_ids` on the pointer path) is restored with the current `_CONSUMED_CAPACITY` 64. `_add_consumed` (client/godot/core/virtual_pad_core/virtual_pad_core.gd:560-561) can only allocate on the press that finds `_consumed_count == _consumed_ids.size()`, i.e. the press made after exactly `_CONSUMED_CAPACITY` tracked consumed pointers. `test_a_press_after_16_consumed_pointers_allocates_nothing` (:67-68) measures the 17th press, far below 64, and `test_a_press_beyond_the_tracked_consumed_pointers_allocates_nothing` (:71-72) presses `_CONSUMED_CAPACITY + 4` = 68 touches in the unmeasured loop of `_press_after_consumed` (:84-85), so with growth restored the array grows to 128 at the 65th touch before the measurement starts, and the measured 69th press does not grow it. Checked in a temporary worktree of HEAD (worktrees/_core/review-tmp-mw3qt9ukd6dd58, removed afterwards): replacing `return` at virtual_pad_core.gd:561 with the old `_consumed_ids.resize(maxi(_CONSUMED_CAPACITY, _consumed_count * 2))`, `ogw core test godot VirtualPadCore --file client/godot/core/virtual_pad_core/tests/test_memory.gd` passed (job `mw3qwg5u38cbb0`); with the same defect and :72 changed to `_press_after_consumed(VirtualPadCore._CONSUMED_CAPACITY)`, it failed at that test ("a press after 64 consumed pointers allocates no memory", job `mw3qwsnk83bdb8`). A later change that lowers the capacity back or reintroduces growth at the boundary is not caught | Measure the press made when every slot is in use: call `_press_after_consumed(VirtualPadCore._CONSUMED_CAPACITY)` (the 64 tracked consumed pointers fill every slot and the measured press takes the full-array branch), keeping the beyond-capacity case if wanted | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R9-1 | fixed | `_consumed_ids` is sized once in `init` (client/godot/core/virtual_pad_core/virtual_pad_core.gd:114) with `_CONSUMED_CAPACITY` 64 (:43), and `_add_consumed` returns without writing when every slot is in use (:560-561), so no path from `_on_element_input` (:519-520) to `InputCore.inject_action` allocates for the consumed tracking. `_reset_state` (:922) empties it and the next `init` sizes it again. A consumed press beyond 64 is not tracked; that only lets a `Hidden` pad be hidden while that pointer is still pressed, which virtual-pad-core.md:38 does not forbid, and the left mouse button made from touch is tracked by `_mouse_consumed` (:537) regardless of the slots. `ogw core test godot VirtualPadCore --file .../test_memory.gd` passed on this checkout (job `mw3quw1tb0e2f7`). The weakness of the added tests is R10-1 |
| R9-2 | fixed | The `## test` item at open-game-works-core/skills/client-core/modules/virtual-pad-core.md:226 now reads as proposed (touch support turned off with `set_test_touch_support(false)` while a touch in a button area is held; harness commit 3cea058), and `client/godot/core/virtual_pad_core/tests/test_state.gd:117-132` (`test_hidden_elements_become_not_visible_after_the_held_touch_is_released`) checks both parts: visible while held and after a move, `Hidden` and not visible after the release. The first sentence is checked by `test_state.gd:78-98` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only `test_memory.gd` was run (native; the job printed `pass` for both runs). The other VirtualPadCore test files and the `--web` run were not run in this review; the core agent report says they pass
- Whether any device reports more than 64 touch points at once (the case where a consumed press is not tracked) was not checked on devices
- Whether a `Hidden` pad hidden while an untracked consumed touch is still pressed changes where the engine GUI sends that touch's release (`gui.touch_focus`) was not checked in the engine source; only the mouse focus case (R4-1) is covered by `test_ui_below.gd`
