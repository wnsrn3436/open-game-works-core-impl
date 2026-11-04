# VirtualPadCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/virtual_pad_core/virtual_pad_core.gd:440 | Input D1 is still open (the commit range 875d331..875d331 is empty, so the code is unchanged). `_apply_state` gives every element `MOUSE_FILTER_STOP` while `Active`. A pointer pressed outside all element areas has no touch focus in Godot 4.7.2, so its `InputEventScreenDrag` goes to the element control under its position, which marks it handled; `InputCore._on_unhandled_input` (client/godot/core/input_core/input_core.gd:627) then does not run `_judge_move`, and `_on_element_input` (virtual_pad_core.gd:497) ignores the drag because `element.pointer_id` differs. This consumes a move of a pointer pressed outside the areas, which open-game-works-core/skills/client-core/modules/virtual-pad-core.md:98 says is not consumed. Reproduced at HEAD on Godot 4.7.2 headless in a temporary copy of client/godot outside the checkout, with a test file added to core/virtual_pad_core/tests/ run through the harness `gutRun`: with `LAYOUT_FIXED` open, `touch(0, true, (1000, 200))`, `drag(0, (1000, 300))`, then `drag(0, center_of(FIRE))` leaves `recorder.drags` at 1 (`[1] expected to equal [2]`), while the same sequence with the last move to (1000, 400) outside the areas passes. So a world drag (e.g. a camera drag) publishes no `DragEvent` `Move` while the finger is over an element. client/godot/core/virtual_pad_core/tests/test_pointer.gd:65 only presses and releases outside the areas and never moves across an area | Do not let element controls take moves and releases of pointers they do not hold: e.g. keep the elements `MOUSE_FILTER_IGNORE` and decide ownership at the UI stage from the press position (the `InputCore` pointer observer or `_input`), or have `_on_element_input` leave a `ScreenDrag`/`ScreenTouch` of a pointer that no element holds and that was not pressed inside an area unhandled (`accept_event` only for consumed pointers, with a filter that passes the others). Add a test to test_pointer.gd that drags a pointer pressed outside the areas across an element area and asserts a `DragEvent` per move and no action of that element | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | client/godot/core/virtual_pad_core/ and client/godot/core/input_core/ are unchanged (empty commit range). The reproduction in a temporary copy on Godot 4.7.2 headless fails with `[1] expected to equal [2]` for a drag of an outside pointer over the FIRE area, and passes for the same drag outside the areas |

## must fix

none

## unknown

- The commit range 875d331..875d331 is empty, so no change was reviewed; the review covered only input D1 and the code it points to (virtual_pad_core.gd `_apply_state`, `_on_element_input`, `_press`, `_move`, input_core.gd `_on_unhandled_input` and the UI stage before it). The rest of the module was not audited for out-of-scope problems
- The reproduction used `build/data/` of the main core-impl checkout (commit c1c9496), since the worktree has no built data; the test touches no data table, and the control test in the same run passed
- The whole VirtualPadCore test suite was not run; only the reproduction file was run in the temporary copy
