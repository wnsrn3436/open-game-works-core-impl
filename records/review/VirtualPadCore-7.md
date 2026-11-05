# VirtualPadCore review round 7

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R7-1 | spec | medium | client/godot/core/virtual_pad_core/virtual_pad_core.gd:445 | Debt item D2 is still present. `_apply_state` hides a `Hidden` pad only with `RenderingServer.canvas_item_set_visible` on the pad canvas item (:445) and never sets `visible` of the pad or its element `Control`s, so the elements stay `is_visible_in_tree()`. `QACore.list_ui` collects every `Control` that is `is_visible_in_tree()` (client/godot/core/qa_core/dev/qa_query.gd:214, the mapping of godot.md:397 for the visible element of qa-core.md:342), so on a desktop dev run (device not `Touch`, state `Hidden`) it lists the pad elements with their rects although they are not drawn. The `InputBlockCore` pass list checks only `is_visible_in_tree()` (client/godot/core/input_block_core/input_block_core.gd:485 and :499), so a pad element in a pass list lets a position and focus pass while the pad is `Hidden`. virtual-pad-core.md:38 says only that `Hidden` "does not draw", and neither virtual-pad-core.md, qa-core.md:342 nor input-block-core.md:106 says whether a `Hidden` element is a visible UI element. Hiding the element `Control`s would drop the engine mouse focus that the R4-1 fix needs (comment at virtual_pad_core.gd:438-441), so the code cannot be changed alone | Decide in the definitions whether the elements of a `Hidden` virtual pad are visible UI elements for `QACore.list_ui` and the `InputBlockCore` pass list (e.g. state in virtual-pad-core.md that they are not, and have QACore and InputBlockCore leave out the elements while `VirtualPadCore.get_state` is `Hidden`, or state that they are), then make the code and tests follow it | yes | 85 |

## previous

none (round 6 has no findings and no `open` rows in `## previous`)

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | open | R7-1 | `virtual_pad_core.gd:445` still hides the `Hidden` pad only in the rendering server, and `qa_query.gd:214` and `input_block_core.gd:485`/`:499` still judge visibility only by `is_visible_in_tree()`. The defining documents (virtual-pad-core.md:38, qa-core.md:342, input-block-core.md:106, godot.md:397) still do not settle whether a `Hidden` element is visible. No earlier finding of this review is `open` for it, so it is written anew as R7-1 |

## must fix

none

## unknown

- The commit range `8073a68..8073a68` is empty, so there are no changed places and no findings from changes. Only the debt item D2 was checked, by reading the current code of `virtual_pad_core.gd`, `qa_query.gd` and `input_block_core.gd` and the current defining documents
- No core test was run, because no code changed and D2 needs a spec decision, not a restored-defect check
