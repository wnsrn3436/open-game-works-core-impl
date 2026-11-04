# BadgeCore review round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | client/godot/core/badge_core/tests/test_save.gd:127-154 adds `test_persist_item_set_before_load_saved_with_no_saved_key_is_saved` (`set_item(saved_badge, 5, 1)` before `load_saved`, no `BadgeCore.items` key: `differ` stays false, memory count 1, read count 0) and `test_persist_item_set_before_load_saved_that_the_saved_values_lack_is_saved` (saved `[saved:6=3, saved_dot:-3=1]` equal to memory plus `saved:5=1` only in memory: `differ` false, memory count 3, read count 2). Both assert the saved array after the frame end and 0 warns. Defect restored in a temporary copy outside the target checkout (`git archive HEAD` into a separate folder under worktrees/_core/ with its own git repo, then badge_core.gd:255 `if differ or memory_items != read_items.size():` replaced with `if differ:`): `ogw core test godot BadgeCore --file client/godot/core/badge_core/tests/test_save.gd` gave `BadgeCore fail` with exactly the two new tests failing (`[]` expected to equal `["132995401:5=1"]`; `["132980366:-3=1", "132995401:6=3"]` expected to equal the array with `132995401:5=1` added). The same run on the unchanged copy gave `BadgeCore pass`. The temporary copy was deleted |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only `client/godot/core/badge_core/tests/test_save.gd` changed for BadgeCore in the commit range (plus records/review-debt/BadgeCore.json and records/review/BadgeCore-2.md); badge_core.gd is unchanged, so only the new tests and the `load_saved` path they reach (badge_core.gd:218-256) were read.
- The test runs were native headless runs of test_save.gd only (`--file`); the browser run (`--web`) and the other BadgeCore test files were not run in this review.
- A second `load_saved` call in one session (spec does not state it) was not judged, as in round 2.
