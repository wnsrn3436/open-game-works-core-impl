# review: RequirementCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/requirement_core/requirement_core.gd:518 | The change adds `_owner_slots.remove_at(_owner_slots.find(slot))` to `_remove_watch_at`. Frame code calls `_remove_watch_at`: `requirement_core_node.gd` `_process()` → `RequirementCore._on_frame()` → `_remove_watch_at(slot)` (:631) when an owner is destroyed, and `_run_batch()` (:638) → `_remove_watch_at(i)` (:668, :677). `engines/godot.md` `## frame code` says core frame code does not change a collection size (`remove_at()` is named). It also says a reused collection is sized once outside frame code and only an `int` count changes. Run path: watch with an owner, free the owner, next `_process` shrinks `_owner_slots` inside frame code. The static frame check (`core-frame-check.ts`) covers only node finding and `await`, so no tool catches this | Keep `_owner_slots` as a buffer that grows only outside frame code (in `watch`/`_store_watch`) plus an `int` count. Remove by moving the last used entry into the freed index and lowering the count. The frame loop already knows index `i`, so it can do this without `find` | no | 90 |
| R1-2 | efficiency | medium | client/godot/core/requirement_core/requirement_core.gd:518 | `_on_frame` (:628-631) goes over `_owner_slots` backward. For each destroyed owner watch it calls `_remove_watch_at(slot)`, which runs `_owner_slots.find(slot)`, a linear search from index 0 to the current index `i`, then `remove_at`, which shifts the tail. When k owner watches of one destroyed screen root go in one frame, out of n owner watches, that frame costs O(k·n) (k = n when a whole screen with all its watches is freed: O(n²)). Before the change, owner bookkeeping on removal was an O(1) counter decrement | Remove by known index as in R1-1: the frame loop passes `i`; `unwatch` may still search | no | 80 |

## previous

none

## out of scope

- client/godot/core/requirement_core/requirement_core.gd:508: medium `_remove_watch_at` also runs `_free_slots.append(slot)` (:508), `slots.remove_at(...)` (:510) and `_slots_by_id.erase(...)` (:512). It does these from frame code (`_on_frame` :631, `_run_batch` :668, :677), which breaks the `engines/godot.md` `## frame code` rule against changing a collection size. These lines existed before the range
- client/godot/core/requirement_core/requirement_core.gd:649: medium `_run_batch` (frame code via `_on_frame`) goes over every slot of `_watches` three times per round (:649, :655, :658). It does so even when only a few watches are pending, so the cost of one frame with a pending evaluation grows with the total number of watches, not the pending ones. `_on_user_state_changed`, `_on_named_trigger` and `_on_content_event` (:685, :698, :708) likewise go over every slot per event. This existed before the range

## debt

none

## must fix

none

## unknown

- The core tests were not run in this review. The claim that the new test `test_the_owner_list_holds_only_the_owner_watch_slots_and_a_destroyed_owner_removes_exactly_its_watches` passes rests on the core agent report. A trace of the slot order (owner slots `[18,16,14,12,8]` after the `unwatch`) shows that a forward loop would index past the end. So the test does fail if the backward iteration is dropped
- The BootstrapCore and QACore changes in the same commit range are outside the target and were not reviewed
- The frame cost of R1-2 was not measured. The evidence is the code path only
