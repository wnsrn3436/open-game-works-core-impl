# BadgeCore review round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | test evidence | medium | client/godot/core/badge_core/badge_core.gd:255 | The new condition `memory_items != read_items.size()` is the only thing that saves at the frame end of `load_saved` when memory holds a `persist` item that is not in the saved values and every saved element is valid and equal to memory (spec `### save`: save when the save targets in memory differ from the saved values). No test reaches that case: every test that calls `load_saved` has either no `persist` item in memory before the call (test_save.gd `test_persist_items_come_back_after_release_init_and_load_saved`, `test_long_limit_item_keys_are_saved_and_read_back`, `start_saving` of tests/support/badge_test_case.gd:95, test_requirement.gd:62), or memory equal to the saved values (`test_load_saved_with_equal_values_in_another_order_writes_nothing`), or a difference that already sets `differ` at badge_core.gd:237/242/247 (`test_set_item_before_load_saved_does_not_save_and_merges_with_saved_items` differs by count 1 vs 9; `test_malformed_saved_elements_are_dropped_with_a_warn_and_the_rest_are_read`, `test_duplicate_saved_element_is_saved_away`, `test_item_keys_out_of_the_long_range_are_dropped_with_a_warn` and test_errors.gd `test_malformed_saved_element_is_a_warn` drop elements). So replacing line 255 with `if differ:` leaves every BadgeCore test passing while `set_item(saved_badge, 5, 1)` before `load_saved` with no `BadgeCore.items` key (or with saved values that lack that item) is never saved until another change. Found by tracing each test that calls `load_saved`; the mutation was not run | Add a test: `set_item` on a `persist` badge before `load_saved`, saved values without that item and with no other difference (absent key, and a saved array of other equal items), then after the frame end `BadgeCore.items` holds the memory item | no | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | badge_core.gd:229-256: `load_saved` sets `_save_pending` only when an element is dropped (malformed, badge not in data, `persist` false, duplicate badge ID and item key), a memory count differs from the saved count, or the number of memory `persist` items differs from the distinct saved items read. Every read item is in memory after the loop (kept or added by `_put_item`), so the count comparison is equal exactly when memory and saved values are the same set; element order and text are not compared. Before `load_saved` `_saving` is false, so `_put_item` (badge_core.gd:648) cannot have set `_save_pending` earlier. Tests `test_load_saved_with_no_saved_key_and_no_persist_items_writes_nothing` and `test_load_saved_with_equal_values_in_another_order_writes_nothing` (test_save.gd:88-122) check that the `user` file is not written |
| R1-2 | fixed | badge_core.gd:765: the 19-digit limit is `9223372036854775808` when `text` had a leading `-` (digits shorter than text) and `9223372036854775807` otherwise; `--5` still fails on the digit check. `test_long_limit_item_keys_are_saved_and_read_back` saves item keys `-9223372036854775808` and `9223372036854775807` and reads them back after `release`, `init`, `load_saved` with 0 warns; `test_item_keys_out_of_the_long_range_are_dropped_with_a_warn` checks `-9223372036854775809` and `9223372036854775808` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: badge_core.gd:255 sets `_save_pending` only when memory and saved values differ; with no `BadgeCore.items` key and no `persist` item in memory, `differ` is false and both counts are 0, so `_save` is not called and `LocalDataCore._write_entry` is not reached |
| D2 | fixed | none | Same as R1-2: `_is_decimal` (badge_core.gd:765) compares negative digits with `9223372036854775808`, so the element `<badge ID>:-9223372036854775808=<count>` that `_save` writes is read back by `_parse_element` |

## must fix

none

## unknown

- No test or Godot run was made in this review. The core test of this worktree has no `addons/` (GUT) and needs the test host and run config that `ogw core test` sets up; R2-1 comes from tracing every test that calls `BadgeCore.load_saved` (badge_core tests and the `start_saving` helper; the only other caller in client/godot/core is bootstrap_core.gd), and the R1-1/R1-2 results from reading the code and the new tests. The core agent report states the new tests fail on the old badge_core.gd; that was not rerun.
- `String.to_int("-9223372036854775808")` giving the `long` minimum relies on Godot 4.7.2 `String::to_int` accumulating 9223372036854775808 in an `int64_t` and negating it (two's complement wrap); it was not checked on another engine version.
- A second `load_saved` call in one session (spec does not state it) was not judged: `_saving` is already true, so `_put_item` sets `_save_pending` for each added item.
- The commit range changes many other modules; only BadgeCore code and tests (badge_core.gd, tests/test_save.gd) changed for this target, and the review read those, the callers and callees of `load_saved`, `_save`, `_put_item`, `_parse_element`, `_is_decimal`, and the BadgeCore tests that call `load_saved`.
