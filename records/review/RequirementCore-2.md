# review: RequirementCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `_owner_slots` grows only in `_store_watch` (client/godot/core/requirement_core/requirement_core.gd:505-510), which `watch` calls. Frame code calls `_remove_watch_at` (`_on_frame` :647, `_run_batch` :684, :693), which now calls `_remove_owner_at` (:533-537). That function only lowers `_owner_count` and writes one index, so it changes no collection size. `_on_frame` loops over `_owner_count` (:644). Trace of the backward loop: at index i the removed entry has `owner_index == i`, and the entry moved into i comes from index `_owner_count` (> i, already checked and alive), or is the entry itself when i is the last used index. So no live entry is skipped and no removed entry stays. The new test `test_the_frame_code_removes_the_watches_of_destroyed_owners_without_changing_the_owner_list_size` (client/godot/core/requirement_core/tests/test_watch.gd:243) asserts `_owner_slots.size()` is unchanged after the frame, which the old `remove_at` code would fail. `_reset` sets `_owner_count` to 0 (:767), and test_lifecycle.gd:50 checks it |
| R1-2 | fixed | Each owner watch keeps `owner_index` (client/godot/core/requirement_core/requirement_watch.gd:16-17), which `_store_watch` sets (:509). `_remove_watch_at` removes by that index (:515-516) with no `find` and no tail shift. So removing k owner watches in one frame costs O(k) owner bookkeeping. `_assert_owner_indexes` (tests/test_watch.gd:298-301) checks `owner_index == i` for each used entry after `watch`, `unwatch` and frame removals |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The core tests were not run in this review. The claim that the changed and new tests pass rests on the core agent report (records/1792915721115-review-fix-mvnjq8bf04f4cd.md)
- The round-1 `## out of scope` problems are still present and are not listed again here. These are collection size changes in `_remove_watch_at` from frame code (:518-524), and the full `_watches` scans of `_run_batch` and the trigger handlers (:666, :670, :673, :701, :714, :724). records/review-debt/RequirementCore.json already holds them as D2 and D3. Debt item D1 there describes a full `_watches` loop in `_on_frame` guarded by `_owner_watch_count`. That code no longer exists: `_on_frame` now loops over `_owner_slots` up to `_owner_count` (:644). It was not judged here, because input `## debt` is `none`
- The BootstrapCore, QACore and other record changes in the same commit range are outside the target and were not reviewed
