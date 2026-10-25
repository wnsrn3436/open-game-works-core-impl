# review fix: RequirementCore round 1

## done

- `RequirementCore` (Godot): `_owner_slots` is now a buffer that only `watch` (`_store_watch`) grows. A new `int` field `_owner_count` holds how many entries are in use. Each watch with an owner keeps its index in the owner list (`owner_index` in `requirement_watch.gd`). `_remove_owner_at` removes an entry in O(1): it moves the last used entry into the freed index and lowers the count. Frame code no longer changes the size of `_owner_slots`, and removing an owner watch no longer searches the list
- Tests: `client/godot/core/requirement_core/tests/test_watch.gd`, `client/godot/core/requirement_core/tests/test_lifecycle.gd`
- Last `ogw core test`: `godot` and `godot --web` on BadgeCore, BootstrapCore, ChatCore, CutsceneCore, NoticeCore, QACore, RequirementCore, ShortcutCore, TutorialCore and UnitTestCore (the `ogw core dependents RequirementCore` list). All pass. QACore was `skipped` only in the native run, because the macOS screen was locked and the render pass did not run, and it passed in the `--web` run
- `ogw code check core`: type check, lint, dependency and secret all pass

## spec proposals

none

## review

- R1-1: fixed. `client/godot/core/requirement_core/requirement_core.gd:58` (`_owner_count`), `:505-510` (the buffer grows only in `_store_watch`), `:516` and `:533-538` (`_remove_owner_at` swaps the last entry in and lowers the count, with no `remove_at`), `:644` (the frame loop runs over `_owner_count`). Added test `test_the_frame_code_removes_the_watches_of_destroyed_owners_without_changing_the_owner_list_size` (`tests/test_watch.gd:243`). It frees an owner that has 24 of 30 owner watches, then checks three things: `_owner_slots.size()` is the same before and after the frame, the remaining entries are exactly the live owner watch slots, and a later `watch` reuses the buffer without growing it. `test_lifecycle.gd` checks that `_owner_count` is reset to 0
- R1-2: fixed. Each owner watch stores `owner_index` (`requirement_watch.gd`), so `_remove_watch_at` removes by index in O(1) from both frame code and `unwatch`, with no `find` and no tail shift. Added `_assert_owner_indexes` (`tests/test_watch.gd:298`). It checks that `_watches[_owner_slots[i]].owner_index == i` for every used entry, after `watch`, after `unwatch` and after removals in frame code. It is called from the existing owner list test and from the new test

## unverified

- The frame cost of a large removal was not measured. The O(1) claim rests on the code path: one swap and a count decrement per removed watch
- Out of scope and not changed: `_remove_watch_at` still runs `_free_slots.append`, `slots.remove_at` and `_slots_by_id.erase` when frame code calls it (the review's `## out of scope`, :508). So a watch removal in frame code still changes the size of those collections
