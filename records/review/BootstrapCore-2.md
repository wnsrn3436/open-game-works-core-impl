# review BootstrapCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `start_boot` now sets `_boot_entry_scene = _find_boot_entry_scene()` after the module list and replacements are set, whether or not a list is given (client/godot/core/bootstrap_core/bootstrap_core.gd:178). `_find_boot_entry_scene` (bootstrap_core.gd:187-198) takes `current_scene` when its `scene_file_path` is `application/run/main_scene` (the harness writes `res://boot/boot.tscn`, `open-game-works-core/tools/src/commands/generate/lib/godot-project.ts:185`) and none for a boot with kept test replacements. `_title_scene_stage` frees it after a successful `boot_change_scene` (bootstrap_core.gd:469-471). Restored the old rule (record only when `modules.is_empty()`, else `null`) in a temporary worktree `worktrees/_core/review-mw2jkkk0df7563-a` of c86518f; `ogw core test godot BootstrapCore --file client/godot/core/bootstrap_core/tests/test_boot_order.gd` failed `test_title_scene_frees_the_boot_entry_scene_of_a_boot_given_a_module_list` |
| R1-2 | fixed | New tests client/godot/core/bootstrap_core/tests/test_boot_order.gd:247 (entry scene present while the title scene starts, freed after `TitleScene`), :262 (failed `boot_change_scene` keeps it), :275 (boot with test replacements keeps it). Restored the defect by replacing `_boot_entry_scene.queue_free()` with `pass` (bootstrap_core.gd:470) in a temporary worktree `worktrees/_core/review-mw2jkkk0df7563-b` of c86518f; `ogw core test godot BootstrapCore --file client/godot/core/bootstrap_core/tests/test_boot_order.gd` failed `test_title_scene_frees_the_boot_entry_scene_of_a_boot_given_a_module_list` |
| R1-3 | fixed | New tests client/godot/core/bootstrap_core/tests/test_boot_restart.gd:161 (restart in `Update`), tests/test_boot_exit.gd:90 (exit in `Update`), tests/test_boot_exit.gd:202 (`shutdown` before `ContentInit`), each holding the boot in `Update` with `hold_update` (tests/support/boot_test_support.gd:172) and asserting `release_count` 0 and the reverse-order module `release` trace. Restored the defect by replacing both `if _content_inited:` guards (bootstrap_core.gd:1208 in `_reverse_release`, :1270 in `_shutdown`) with `if true:` in a temporary worktree `worktrees/_core/review-mw2jkkk0df7563-c` of c86518f; `--file` runs of tests/test_boot_exit.gd and tests/test_boot_restart.gd failed `test_exit_in_update_has_no_content_release`, `test_shutdown_before_content_init_has_no_content_release` and `test_restart_in_update_releases_modules_without_content_release` with `[1] expected to equal [0]` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | fixed | none | Same problem as R1-1: bootstrap_core.gd:178 records the boot entry scene for a boot given a module list; the test of test_boot_order.gd:247 fails when the old rule is restored |
| D3 | fixed | none | Same problem as R1-2: replacing `_boot_entry_scene.queue_free()` with `pass` now fails `test_title_scene_frees_the_boot_entry_scene_of_a_boot_given_a_module_list` |
| D4 | fixed | none | Same problem as R1-3: the three new tests cover restart and exit in `Update` and `shutdown` before `ContentInit`, and fail when the `_content_inited` guards are removed |
| D5 | fixed | none | Same problem as R1-2: the `TitleScene` destruction of the boot entry scene is tested by test_boot_order.gd:247 and :262, and the restored defect fails :247 |

## must fix

none

## unknown

- The commit range also changes many other modules (SceneCore, GameUpdateCore and others). Only the BootstrapCore files of the range and the callers of `start_boot` under client/godot were read; changes of other modules were checked only where BootstrapCore calls them in the changed paths.
- Tests were run with `--file` on the native (headless) run only, in temporary worktrees for the restored defects. The unmodified files test_boot_order.gd, test_boot_exit.gd and test_boot_restart.gd passed in `--file` runs on the main checkout of `open-game-works-core-impl/` at ea55a26 (newer than c86518f, the end of the range), not on c86518f itself. The browser run (`--web`) was not run.
- Whether an exported build keeps `scene_file_path` of the main scene equal to the `application/run/main_scene` value (e.g. when the value is a `uid://` path) was not checked in a build; the harness writes a `res://` path.
