# BadgeCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/badge_core/badge_core.gd:239 | `load_saved` sets `_save_pending = true` on every successful call, whatever was read. The spec (`### save`) saves after `load_saved` only when the save targets in memory differ from the saved values. Run path: a `user` file without the key `BadgeCore.items` and no item badge of a `persist` badge in memory (first login, or a game without a `persist` badge) -> `load_saved` returns `true` with `_save_pending` true -> `_run_frame_end` (badge_core.gd:511) -> `_save` (badge_core.gd:604-613) calls `LocalDataCore.set_array_string` with an empty array -> `LocalDataCore._write_entry` (client/godot/core/local_data_core/local_data_core.gd:544) finds no entry for the key, so it adds it and marks the `user` file dirty. Memory and saved values are both empty, yet the file is written. Saved values equal to memory but in another element order (the order of `_order` and of `badge.items` differs from the stored array) also pass `_is_same` as different and are rewritten. No test in client/godot/core/badge_core/tests/test_save.gd checks that nothing is written when they do not differ. Found by reading this path; not run | In `load_saved`, set `_save_pending` only when an element was discarded (malformed, badge not in data, `persist` false, item already in memory with a different count, duplicate) or a memory save target is not in the saved values; or compare the array `_save` would write with the saved array as a set before writing. Add a test that `load_saved` with equal memory and saved values (including the absent key with no persist items) leaves the `user` file not dirty | no | 85 |
| R1-2 | correctness | medium | client/godot/core/badge_core/badge_core.gd:747 | `_is_decimal` strips `-` and compares the digits with the positive limit `9223372036854775807`, so `-9223372036854775808` (the `long` minimum) gives `false`: length 19 and the string `9223372036854775808` > `9223372036854775807`. `set_item` accepts that item key (badge_core.gd:163 rejects only 0; the spec allows any non-zero `long`), `_save` writes `<badge ID>:-9223372036854775808=<count>` (badge_core.gd:612), and after a restart `load_saved` -> `_parse_element` (badge_core.gd:730) returns empty and the element is dropped with a warn log (badge_core.gd:232), so the item badge is lost | Compare negative digits with `9223372036854775808` (the limit depends on the sign), and add a test that saves and reloads item key `-9223372036854775808` | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | badge_core.gd:239 still sets `_save_pending = true` unconditionally after reading the saved values; the path through `_save` (badge_core.gd:613) and `LocalDataCore._write_entry` (client/godot/core/local_data_core/local_data_core.gd:544) is unchanged |
| D2 | open | R1-2 | badge_core.gd:740-747 still trims the sign and compares with `9223372036854775807` for both signs |

## must fix

none

## unknown

- The commit range is empty (e02d2bf..e02d2bf), so no change of that range could cause a finding; the review covered the input debt items and read badge_core.gd, badge_view.gd, badge_core_node.gd, badge_state.gd and the test names of tests/ for problems for `## out of scope`.
- No test or Godot run was made. R1-1 and R1-2 come from reading the code paths; the string comparison of R1-2 is plain lexicographic comparison of two 19-digit strings.
- The test bodies of tests/test_tree.gd, tests/test_view.gd, tests/test_requirement.gd and tests/test_evaluator.gd were not read line by line for `test evidence`, since no code in the range changed.
- The behavior of calling `load_saved` twice in one session (items cleared after the first call re-added from the saved values before the frame-end save) was not judged: the spec does not state a second call.
