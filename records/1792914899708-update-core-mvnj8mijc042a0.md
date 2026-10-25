# update core: RequirementCore (client core, godot)

## done

- `RequirementCore` (godot), review debt D1: the frame code no longer loops over every slot of `_watches`. The new static var `_owner_slots` holds the slots of the watches that have an owner object. `_store_watch` adds to it and `_remove_watch_at` takes out of it, and it replaces `_owner_watch_count` (client/godot/core/requirement_core/requirement_core.gd:54, :501-502, :518). `_on_frame` loops backward over only `_owner_slots`. The check for a destroyed owner is still `is_instance_id_valid`, so a removal does not move a slot that is still to be checked (:627-631). `_reset` clears the list, so `release` and a tree teardown still reset every static var (:750). Spec behavior is unchanged. A watch whose owner is destroyed is still removed without a log or callback
- Core tests:
  - `test_watch.gd` `test_the_owner_list_holds_only_the_owner_watch_slots_and_a_destroyed_owner_removes_exactly_its_watches`: sets up 20 watches without owner and removes 10, which leaves null slots. Then 6 owner watches over two owners reuse those slots. The test checks that the list equals exactly the slots that hold owner watches, after each watch, after `unwatch` of an owner watch, and after one owner is destroyed. The frame code alone must remove exactly the 3 watches of the destroyed owner. After that, a trigger calls back only the remaining watches, with no error log
  - `test_lifecycle.gd` `_assert_initial_state`: now checks `_owner_slots`, `_free_slots` and `_slots_by_id` are empty after `release` and after a tree teardown
- No per-engine rules document was written

## spec proposals

none

## review

none

## unverified

- The native run of `ogw core test godot` reported `QACore` as `skipped` because the render pass did not run: the macOS screen was locked or the display was asleep. `QACore` passed in the `--web` run. Every other module passed in both runs
- The drop in per-frame cost was not measured. The tests check what is in the list, not frame time
