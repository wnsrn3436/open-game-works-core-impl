# VirtualPadCore review fix round 9

## done

- `VirtualPadCore` (Godot): the tracking of consumed touch pointers (`_consumed_ids`) is made once in `init` with `_CONSUMED_CAPACITY` 64 slots and no longer grows on the pointer path. A consumed press that finds every slot in use is not tracked (`client/godot/core/virtual_pad_core/virtual_pad_core.gd:41-43`, `:560-561`)
- Tests: `client/godot/core/virtual_pad_core/tests/test_memory.gd` `test_a_press_after_16_consumed_pointers_allocates_nothing` (the review run path: 16 touches pressed in the `fire` area, then a `stick` press at 0.5 times the radius, measured with `OBJECT_COUNT` and `MEMORY_STATIC`, and `InputCore.get_vector` (0.5, 0)) and `test_a_press_beyond_the_tracked_consumed_pointers_allocates_nothing` (the same after `_CONSUMED_CAPACITY` + 4 consumed touches, the branch where every slot is in use)
- No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written

## spec proposals

none

## review

- R9-1: fixed. `virtual_pad_core.gd:560-561` returns without growing when every slot is in use, and `init` (:114) makes the 64 slots. Tests `test_memory.gd::test_a_press_after_16_consumed_pointers_allocates_nothing` and `::test_a_press_beyond_the_tracked_consumed_pointers_allocates_nothing`. The cause was reproduced: with the old `_add_consumed` (growth by `resize`) and the new tests, `ogw core test godot VirtualPadCore --file .../test_memory.gd` failed at `test_a_press_after_16_consumed_pointers_allocates_nothing` ("a press after 16 consumed pointers allocates no memory"), and it passes with the fix
- R9-2: not fixed; its `spec change` is `yes`. The spec proposal of the earlier report stands (reword the second sentence of the virtual-pad-core.md:226 `## test` item so that the state stays `Hidden` through the release)

## unverified

- The native render pass of `VirtualPadCore` and `QACore` was not run: both native runs of `ogw core test godot BootstrapCore QACore UnitTestCore VirtualPadCore` reported `skipped` ("render pass not run: the macOS screen is locked or the display sleeps"). The native headless pass of those modules ran and passed, `BootstrapCore` and `UnitTestCore` passed, and the `--web` run of all four modules passed. `ogw code check core` passed
- That 64 slots are above the touch points any device reports at once was not checked on devices. With more consumed touches held at once than that, a touch beyond the slots does not keep a `Hidden` pad visible until its release (R7-1 behavior); actions are not affected
