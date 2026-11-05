# VirtualPadCore review round 8

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R7-1 | open | The spec change of this round (`skills/client-core/modules/virtual-pad-core.md:38` in the harness, and the new `## test` item at :226) settles the spec decision R7-1 asked for: while `Hidden` and no pointer whose press was consumed in an element area is still pressed, the elements are not visible UI elements (for `QACore.list_ui`, a visible element is one whose own engine display state and those of all its ancestors are on, qa-core.md:135, mapped to `is_visible_in_tree()` by godot.md:397). The code did not follow: the commit range changes only `records/` files, and `client/godot/core/virtual_pad_core/virtual_pad_core.gd:445` still hides a `Hidden` pad only with `RenderingServer.canvas_item_set_visible` and never sets `visible` of the pad or its element `Control`s (no `.visible`, `hide()` or `show()` in `client/godot/core/virtual_pad_core/*.gd`). Run path: `open_layout` with a valid layout, then `InputCoreDev.set_test_device(GAMEPAD)` with no pointer held → `get_state()` is `HIDDEN`, but every element `Control` is still `is_visible_in_tree()`, so `QACore.list_ui` (`client/godot/core/qa_core/dev/qa_query.gd:214`) lists them and the `InputBlockCore` pass list (`client/godot/core/input_block_core/input_block_core.gd:485`) treats them as visible. No test checks the new `## test` item (no `visible` or `list_ui` assertion in `client/godot/core/virtual_pad_core/tests/`; `test_ui_below.gd:76` and :90 set `GAMEPAD` but assert only actions and clicks). The remaining fix is code and tests only: hide the element `Control`s (or the pad) while `HIDDEN` once no consumed pointer is still pressed, keep them visible until the release of such a pointer (the engine mouse focus of the R4-1 fix, comment at `virtual_pad_core.gd:438-441`), show them again on leaving `HIDDEN`, and add tests for both sentences of virtual-pad-core.md:226 |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | open | R7-1 | The definitions now decide the question of D2 (virtual-pad-core.md:38), so the elements of a `Hidden` pad with no consumed pointer pressed must not be visible to `QACore.list_ui` and the `InputBlockCore` pass list. `virtual_pad_core.gd:445` still leaves them `is_visible_in_tree()`, which `qa_query.gd:214` and `input_block_core.gd:485` read, so the problem remains. R7-1 is `open` in `## previous`, so it is that finding |

## must fix

none

## unknown

- The commit range `8073a68..6c9b746` changes only files under `records/` (review records and review debt lists of other targets); no VirtualPadCore code or test changed, so there are no findings from changes. The check covered the spec change diff against the current `virtual_pad_core.gd`, the VirtualPadCore tests, `qa_query.gd` and `input_block_core.gd`
- No core test was run: no code changed, and R7-1 is judged from the code, which has no visibility change at all
- Whether hiding the element `Control`s after the release of the consumed pointer keeps the R4-1 behavior in the engine was not checked, because that code does not exist yet
