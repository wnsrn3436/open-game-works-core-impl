# VirtualPadCore review round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | client/godot/core/virtual_pad_core/virtual_pad_core.gd:508 | Since commit e608865, `_add_area_pointer` (:530) returns `false` when all `_AREA_POINTER_SLOTS` (32, :41) entries are taken. `_on_element_input` then returns without `accept_event`, so the press is not consumed, no element holds it, and it goes on to the world stage. open-game-works-core/skills/client-core/modules/virtual-pad-core.md `### pointer ownership` says "When `Active`, the press, moves and release of a pointer pressed inside an element area are consumed at the UI stage of `InputCore`. The same applies to such a pointer that no element holds. Such a pointer is not a judge pointer", and sets no limit on the number of such pointers. Reproduced with a probe test in a temporary clone of HEAD: `InputCore.release()`, test setting `InputCore.maxJudgePointers` 20 (so `InputCore` has 36 pointer slots), `InputCore.init()`, device `Touch`, `open(LAYOUT_FIXED)`, `touch(i, true, center_of(FIRE))` for i 0..31, then `touch(32, true, center_of(FIRE))` and `touch(32, false, center_of(FIRE))`. `recorder.taps` went from 0 to 1, so the 33rd pointer pressed in the button area became a judge pointer and made a `TapEvent`. The same steps with the 32nd pointer (i 0..30 held, then pointer 31) left `recorder.taps` at 0. With the default test settings the 33rd press makes no tap, but only because `InputCore` has fewer pointer slots and so does not track that pointer. The lifecycle rule "From receiving a pointer to calling `InputCore.inject_action`, no memory is allocated" rules out an unbounded array, so the spec has to set what happens beyond a limit. The core agent report records/1793824504199-review-fix-mw2ksltyb9a94e.md `## spec proposals` already proposes a limit of 32. No test covers a press beyond capacity | Add to `### pointer ownership` the limit on pointers pressed in element areas and not yet released, and what a press beyond it does (consumed or not, held or not), then make the implementation and a core test follow it | yes | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | client/godot/core/virtual_pad_core/tests/test_pointer.gd:102 now presses the joystick under a `content` block whose pass list has the joystick, opens the popup, and asserts that the state is `INACTIVE` and that `InputCore.get_cancel_count()` did not change, so `_check_cancel` cannot clear `_area_pointers`. In a temporary clone of HEAD, with the `_area_pointers.fill(-1)` in `_set_state` (virtual_pad_core.gd:443) deleted, `ogw core test godot VirtualPadCore` failed only with `test_pointer.gd::test_outside_pointer_after_a_popup_is_unconsumed: [1] expected to equal [2]: the pointer ID released while inactive is not consumed`. Unchanged HEAD passed |
| R2-2 | fixed | New tests test_pointer.gd:125 (`close_layout`) and :135 (scope release through `_on_scope_released`). In a temporary clone of HEAD, with the `_area_pointers.fill(-1)` in `_close` (virtual_pad_core.gd:396) deleted, the suite failed with exactly these two tests, both `[1] expected to equal [2]: the pointer ID held in an area when the layout closed is not consumed`. Unchanged HEAD passed |
| R2-3 | fixed | `init` sizes `_area_pointers` to 32 entries filled with -1 (virtual_pad_core.gd:110). `_add_area_pointer` (:530) only uses `has`, `find` and an indexed write, and never appends. `_close`, `_set_state` and `_check_cancel` only `fill(-1)`, which keeps the size. `_reset_state` (:881) empties it only on `release`, and `init` sizes it again. New test test_memory.gd:44 presses two area pointers right after `open_layout` with no warm-up. In a temporary clone of HEAD with the round 2 code put back (no resize in `init`, append when there is no free entry), the suite failed only with `test_memory.gd::test_first_area_presses_after_open_allocate_nothing: two area pointers at once after open_layout allocate no memory`. Unchanged HEAD passed. The behavior at full capacity that this fix added is R3-1 |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only the headless pass of `ogw core test godot VirtualPadCore` was run (whole module at HEAD and with each defect restored, plus `--file` runs of the probe), in a temporary clone under worktrees/_core/ that was deleted afterwards. The `--web` and render passes and an on-device touch run were not done
- Whether R3-1 can happen on real hardware was not checked. It needs more than 32 pointers pressed in element areas and not yet released at once, either as real simultaneous touches or as stale entries whose release never reached an element while `ACTIVE`, and `InputCore.maxJudgePointers` above 16 so that `InputCore` tracks the extra pointer. How many simultaneous touches devices report, and whether web touch identifiers are reused, were not checked
- The pause case from round 2 (a release that never reaches its element while the state stays `ACTIVE`) was still not tested
- The QACore and BootstrapCore dependents were not run. `ogw review run` runs the dependents' core tests after each fix
