# review VirtualPadCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/virtual_pad_core/virtual_pad_core.gd:440: medium a pointer pressed outside the element areas is consumed while it moves across an element area, which differs from open-game-works-core/skills/client-core/modules/virtual-pad-core.md:98 ("A pointer pressed outside the element areas ... are not consumed"). While `Active` every element has `MOUSE_FILTER_STOP`. Godot 4.7.2 has no touch focus for a pointer pressed outside all controls, so it gives that pointer's `InputEventScreenDrag` to the control under its position and marks the input handled, and `InputCore._on_unhandled_input` (client/godot/core/input_core/input_core.gd:627) does not run `_judge_move`. `_on_element_input` ignores the move because `element.pointer_id` differs. Reproduced at HEAD in a temporary copy with a test added to the module's test folder, with `LAYOUT_FIXED` open: `touch(0, true, (1000, 200))`, `drag(0, (1000, 300))` (recorder.drags is 1), `drag(0, center_of(FIRE))`. recorder.drags stays 1 where 2 is expected (`[1] expected to equal [2]`), so a world drag such as a camera drag publishes no `DragEvent` `Move` while the finger is over an element. client/godot/core/virtual_pad_core/tests/test_pointer.gd:65 only presses and releases outside the areas without moving across one, so no test covers this. Neither client/godot/core/virtual_pad_core/ nor client/godot/core/input_core/ changed in the commit range, so the range did not cause it

## debt

none

## must fix

none

## unknown

- The commit range changes no file of VirtualPadCore (`client/godot/core/virtual_pad_core/`, `core-spec/VirtualPadCore.json`), of the client modules it depends on (`LogCore`, `EventCore`, `LocalDataCore`, `ResourceCore`, `SafeAreaCore`, `InputCore`, `UICore`) or its two settings keys. The range's client changes (`LocalizationCore.list_languages`, `MessageCore.show_black_box`, `PaymentCore` comment, `QACore` settings checks) and generator changes (`tools/data-tool/src/godotgen.ts`, `tools/data-tool/src/corespec.ts`) were read for a path to this module, and none was found
- `ogw core test godot VirtualPadCore` ran only in the headless pass of a temporary copy of HEAD that also held the added test. The run reported that added test as its only failure. The `--web` run and the native render pass were not run
- Pointer behavior was checked through injected `InputEventScreenTouch` and `InputEventScreenDrag` only. Real touch hardware and OS pointer cancel on `android` and `ios` were not checked
- Whether touch support is detected correctly on devices (`DisplayServer.is_touchscreen_available`) was not checked, because the tests replace it with `set_test_touch_support`
- The zero-allocation rule was checked by reading the code and through `tests/test_memory.gd`, which measures `OBJECT_COUNT` and `MEMORY_STATIC`. It was not measured on a device or in a release build
- The static checks `virtual pad layout` and `action reference` are harness tools outside this target. They were read only far enough to confirm that they exist and name the layout classes, and were not run
