# RequirementCore review round 1

## findings

none. The commit range 772306a..7bde716 changes no file of `client/godot/core/requirement_core/` and no definition RequirementCore uses: the code changes are the body and heading font weights of LocalizationCore (`client/godot/core/localization_core/localization_core.gd`, its tests) and the settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight`. RequirementCore uses LocalizationCore only for the `FormatArgs` type (`client/godot/core/requirement_core/requirement_core.gd:249`), which the range does not change, and its tests do not init LocalizationCore (no `LocalizationCore` reference under `client/godot/core/requirement_core/`), so the new required LocalizationCore settings keys do not reach them

## previous

none

## out of scope

- client/godot/core/requirement_core/requirement_core.gd:626: medium efficiency: while one or more watch has an owner object (`_owner_watch_count > 0`), `_on_frame` loops over every slot of `_watches` each frame to find destroyed owners (`is_instance_id_valid` per slot), so the work per frame grows with the number of watches and with the `null` slots, which `_watches` never shrinks (`_remove_watch_at` at :506 only sets `null`). Code path: `requirement_core_node.gd:23` `_process` → `RequirementCore._on_frame` → loop at :627-630. Growing amount: the watch slot count (every screen that sets watches with its root as owner adds slots). Direction: delete the watch from the owner's `tree_exiting`/free notification or keep the owner watches in a separate list

## debt

none

## must fix

none

## unknown

- Tests were not run; the review read the code and the test function list only
- The server `validation.evaluate_requirement` side and the shared core test fixture `requirement-evaluation` were not compared, because the range does not change them
- Whether "before the content update of the next frame" holds for content that updates in `_physics_process` (Godot runs physics steps before `_process` in a frame, and the batch evaluation runs in `_process` at priority -1000) was not checked against the definitions of content update in `client-core`
