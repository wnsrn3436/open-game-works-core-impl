# review: BadgeCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/badge_core/badge_core.gd:239: medium `load_saved` always sets `_save_pending`, but the spec saves only when the save targets in memory differ from the saved values. Run path: a user file without the key `BadgeCore.items` and no item badge in memory (e.g. the first login, or a game with no `persist` badge) -> `_run_frame_end` (badge_core.gd:511) -> `_save` writes an empty array (badge_core.gd:613) -> `LocalDataCore._write_entry` has no such key, so it adds the entry and marks the `user` file dirty (client/godot/core/local_data_core/local_data_core.gd:544). Memory and saved values are both empty, yet the key is added and the file is written. No test covers the case where they do not differ. Found by reading this path; it was not run. The code is outside the commit range
- client/godot/core/badge_core/badge_core.gd:747: medium `_is_decimal` rejects the item key -9223372036854775808. `set_item` accepts it (the spec allows any non-zero `long`, and badge_core.gd:163 rejects only 0) and `_save` writes `<badge ID>:-9223372036854775808=<count>`, but `load_saved` discards that element as malformed with a warn log, so the item is lost after a restart. A scratch script with a copy of `_is_decimal` gave `false` for that text and `true` for 9223372036854775807. The negative value is compared with the positive limit. The code is outside the commit range

## debt

none

## must fix

none

## unknown

- The range f3ac5b0..0da153b changes only `LocalizationCore` (`_restore_heading_types` and its test), no BadgeCore file and no spec. BadgeCore calls only `LocalizationCore.format` (badge_core.gd:333), and its count label sets no `theme_type_variation`, so it is drawn in the `body` text style and does not use the heading types. This comes from reading the code. No test runs BadgeCore with a heading font, `release` and a second `load_fonts`
- `ogw core test godot BadgeCore` (job mw0ucyyld1bf8f) printed `BadgeCore pass` and `BadgeCore pass (reused)`. The meaning of the second line was not checked, so part of the result may come from an earlier run. `--web` and the modules that depend on BadgeCore were not run
- No mutation was run, so whether each BadgeCore test fails on a changed implementation was not checked. The tests were compared with `## test` of the spec by reading only
- Not settled: `set_item` on a `persist` badge followed by `release` in the same frame. `_reset_state` clears `_save_pending` without saving, so that change is not saved. The spec does not say whether `release` saves first, so this was not judged as a problem. Confidence is below 80
- The specs of `EventCore`, `TimeCore`, `ResourceCore`, `DataCore`, `UserStateCore`, `RequirementCore` and `LogCore` and `skills/core/command.md` were not read. `skills/core/SKILL.md` and `engines/godot.md` were read in part or by search, `local-data-core.md` by search, and `localization-core.md` for its first 150 lines. Calls from BadgeCore to those modules were checked only against their use in the code and tests
- The positions of the display (the prefab dot, a parent `Control` with clipping or layout) and the size of the code made dot under a text scale other than 1000 were not run
