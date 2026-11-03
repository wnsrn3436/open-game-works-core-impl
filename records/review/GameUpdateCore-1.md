# review GameUpdateCore round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Scope: the range changes only `client/godot/core/localization_core/localization_core.gd` (`_restore_heading_types`), `client/godot/core/localization_core/tests/test_font_weight.gd` and `records/`. It changes no file of `client/godot/core/game_update_core/`, `core-spec/`, `proto/` or `settings/`. The changed function is private and runs only from `LocalizationCore.release` when `_font_theme` is set (`localization_core.gd:854`), and `_font_theme` is set only by `load_fonts`. GameUpdateCore uses `LocalizationCore` only for the `DownloadedTranslation` type (`game_update_core.gd:72`, `game_update_core.gd:558`). Its test support calls `LocalizationCore.release` but never `load_fonts` (`tests/support/game_update_test_case.gd:267`, `tests/support/game_update_test_case.gd:288`). No `.gd`, `.tres` or `.tscn` under `client/godot/core/` outside `localization_core/` names a heading type, so the system popups of `UICore` that GameUpdateCore opens do not read the changed theme types. These were checked by reading the code
- Tests were not run. No finding needed a test to check it, so the core tests of GameUpdateCore (`ogw core test godot`, `ogw core test godot --web`) have no result from this review
- Read outside the required scope, with no finding: `game_update_core.gd`, `game_update_core_node.gd`, `deploy_list.gd`, `http_update_downloader.gd`, `web_update_downloader.gd`, `update_downloader.gd`, `dev/game_update_core_dev.gd`, compared with `## behavior` of the module spec. This was not a review of the whole target
- Not read: `ed25519.gd` (signature arithmetic, including rejection of non-canonical signatures). In `client/godot/core/game_update_core/tests/`, only `tests/support/game_update_test_case.gd` was read in part. Whether each item of `## test` of the module spec has a test that fails on a defect was not checked
- Not decided: `GameUpdateCore._store_opener`, `_file_hasher` and `_file_writer` (`game_update_core.gd:47`, `game_update_core.gd:50`, `game_update_core.gd:51`) are core test replacements kept in code that is not DEV code, and tests set them directly. They are not in `## DEV` of the spec. The defining documents read here set no rule for test replacements in private state, so whether this breaks the DEV code boundary was not decided. They existed before the range and are unrelated to it
