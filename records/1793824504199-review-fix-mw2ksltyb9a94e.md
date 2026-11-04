# VirtualPadCore review fix round 2

## done

- Module `VirtualPadCore` (Godot), commit e608865
  - `_area_pointers` is sized once in `init` to `_AREA_POINTER_SLOTS` (32) entries filled with -1 (client/godot/core/virtual_pad_core/virtual_pad_core.gd:41, :110). `_add_area_pointer` (:530) no longer appends. It returns `false` when every entry is taken, and then `_on_element_input` (:508) does not accept the press and the element does not take it, so the press goes on like a press outside the areas
  - New tests: test_pointer.gd:102 (rewritten), :125, :135; test_memory.gd:44
- No engine-specific implementation rules document was written. `## <engine> build` of `tools/ogw.md` was not written

## spec proposals

- `### pointer ownership` does not say what happens when more pointers are pressed in element areas at once than the implementation can track without allocating (`### lifecycle` forbids allocation on the pointer path). Proposal: "VirtualPadCore tracks at most 32 pointers that were pressed in element areas and are not yet released at once. A press in an element area beyond that is not held by any element and is not consumed." The implementation does this now with capacity 32. InputCore has its own fixed limit too (`InputCore.maxJudgePointers` + 16 pointer slots)

## review

- R2-1: fixed. client/godot/core/virtual_pad_core/tests/test_pointer.gd:102 `test_outside_pointer_after_a_popup_is_unconsumed` now presses the joystick under a `content` block whose pass list has the joystick. It then opens the popup and asserts that the state is `INACTIVE` and `InputCore.get_cancel_count()` did not change. It releases, closes the popups, unblocks, and checks that a pointer 0 pressed outside and moved into the joystick area gets one `DragEvent` and no direction. On HEAD's virtual_pad_core.gd with the `_set_state` clear (old :439) removed, it fails with `[1] expected to equal [2]`
- R2-2: fixed. Two new tests: test_pointer.gd:125 `test_outside_pointer_after_close_layout_is_unconsumed` covers `close_layout`, and test_pointer.gd:135 `test_outside_pointer_after_a_scope_release_is_unconsumed` covers scope release reaching `_close` through `_on_scope_released`. Both share the helper `_assert_outside_pointer_reaches_the_world`. On HEAD's code with the `_close` clear (old :392) removed, both fail with `[1] expected to equal [2]`. The code line itself was already correct; only test coverage was missing
- R2-3: fixed. virtual_pad_core.gd:41, :110 and :530, as in `## done`. New test test_memory.gd:44 `test_first_area_presses_after_open_allocate_nothing` presses two area pointers at once right after `open_layout`, with no warm-up, and checks that `Performance.MEMORY_STATIC` and `OBJECT_COUNT` do not grow. On HEAD's code (the array grows by append) it fails with "two area pointers at once after open_layout allocate no memory"
- Fix test proof: on HEAD's virtual_pad_core.gd with lines 392 and 439 removed, the four new tests failed and the rest of the suite passed (`ogw core test godot VirtualPadCore`). With the fix they all pass

## unverified

- Final runs: `ogw core test godot VirtualPadCore BootstrapCore QACore UnitTestCore --web` passed for every module. The same run without `--web` passed VirtualPadCore, BootstrapCore and UnitTestCore. It exited 1 only because the QACore render pass was `skipped` ("the macOS screen is locked or the display sleeps"), so that render pass was not run. `ogw code check core`: type check, lint, dependency and secret all pass
- The capacity of 32 was not checked against what real devices report. A press beyond capacity can only be reached with more than 32 simultaneous area pointers, or with stale IDs whose release never reached an element (see the round 2 `## unknown` pause case). No test covers the full case, because it is not in the spec (see `## spec proposals`)
- No on-device touch run was done
