# VirtualPadCore review round 11

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R10-1 | fixed | `test_a_press_with_every_consumed_slot_in_use_allocates_nothing` (client/godot/core/virtual_pad_core/tests/test_memory.gd:72-73) calls `_press_after_consumed(VirtualPadCore._CONSUMED_CAPACITY)`: the 64 touches in the `fire` area each reach `_add_consumed` (client/godot/core/virtual_pad_core/virtual_pad_core.gd:519-520) and fill all 64 slots sized in `init` (:114), so the measured `stick` press with index 64 takes the full-slots branch (:560). Restored in a temporary worktree of HEAD (worktrees/_core/review-tmp-mw3r5497r11, removed afterwards): `return` at virtual_pad_core.gd:561 replaced with the old `_consumed_ids.resize(maxi(_CONSUMED_CAPACITY, _consumed_count * 2))`; `ogw core test godot VirtualPadCore --file client/godot/core/virtual_pad_core/tests/test_memory.gd` failed at the new test ("a press after 64 consumed pointers allocates no memory", job `mw3r5r45fa786f`), and it was the only failure. On this checkout without the change the same command passed (job `mw3r5tmp4b877e`) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only `test_memory.gd` was run, and only natively (headless pass). The other VirtualPadCore test files, the render pass and the `--web` run were not run in this review; the core agent report says the `--web` run passed every module and the native render pass was skipped because the screen was locked
- The other changes of the commit range (server/core/matchmaker/realtime.ts, server/core/matchmaker/tests/rooms.test.ts and other review records) are outside VirtualPadCore and were not reviewed
- The unknowns of round 10 remain unchecked: whether a device reports more than 64 touch points at once, and whether a `Hidden` pad hidden while an untracked consumed touch is still pressed changes where the engine GUI sends that touch's release (`gui.touch_focus`)
