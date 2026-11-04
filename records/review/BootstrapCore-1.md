# review BootstrapCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/bootstrap_core/bootstrap_core.gd:161 | `start_boot` sets `_boot_entry_scene = tree.current_scene` only in the `modules.is_empty()` branch (bootstrap_core.gd:161-164); the `else` branch only copies the list. `_title_scene_stage` frees only `_boot_entry_scene` (bootstrap_core.gd:449-451), and `SceneCore` adds its scene nodes under `tree.root` (client/godot/core/scene_core/scene_core.gd:119-120) without replacing `current_scene`. Run path: a boot entry scene calls `start_boot(entry, list)` with a module list, which `open-game-works-core/skills/client-core/modules/bootstrap-core.md:32` allows → `TitleScene` succeeds → the entry scene stays in the tree, against `bootstrap-core.md:67` "On success, destroys the boot entry scene". Same as debt D2 | Record the boot entry scene independently of whether a module list is given, identifying it by something other than the list (e.g. `current_scene` whose `scene_file_path` is the engine main scene), so that a test or `UnitTestCore` caller does not free the test runner scene | no | 85 |
| R1-2 | test evidence | medium | client/godot/core/bootstrap_core/bootstrap_core.gd:449 | The `TitleScene` behavior "On success, destroys the boot entry scene" (`open-game-works-core/skills/client-core/modules/bootstrap-core.md:67`) has no test. Every `start_boot` in the tests passes a non-empty list (tests/support/boot_test_support.gd:266 through `UnitTestCore.start_test_boot`, client/godot/core/unit_test_core/dev/unit_test_core.gd:1703; tests/test_boot_order.gd:247; tests/test_boot_dev_run.gd:164,188,502,529; tests/test_boot_dev_modules.gd:48,82,177), so `_boot_entry_scene` stays `null`. A search of `client/` for `_boot_entry_scene`, `entry_scene` and `boot entry scene` outside bootstrap_core.gd has no match, and no test in client/godot/core/bootstrap_core/tests refers to `current_scene` or `queue_free`. Replacing `_boot_entry_scene.queue_free()` at line 450 with `pass` therefore fails no test (read from the code, not run). Same as debt D3 and D5 | Add a test that sets a node as the boot entry scene, boots through `TitleScene` and asserts the node is freed, and that a failed `boot_change_scene` leaves it | no | 90 |
| R1-3 | test evidence | medium | client/godot/core/bootstrap_core/tests/test_boot_exit.gd:76 | `open-game-works-core/skills/client-core/modules/bootstrap-core.md:266` requires no `content_release` on a restart or app exit during `Update` and on a `shutdown` before `ContentInit`. The tests assert `release_count` 0 only for the update reboot (tests/test_boot_restart.gd:156), a restart in `TitleScene` (tests/test_boot_restart.gd:171) and an exit in `TitleScene` (tests/test_boot_exit.gd:85). No test halts in `BootStage.UPDATE` (no `wait_stage(BootstrapCore.BootStage.UPDATE)` or restart/exit from a `check_update` hook in tests/), and the `shutdown` calls before `ContentInit` (tests/test_boot_fatal.gd:433, tests/test_boot_exit.gd:189) do not assert `content_release`. By reading, the `_content_inited` guard of `_reverse_release` (bootstrap_core.gd:1188) and `_shutdown` (bootstrap_core.gd:1250) gives the required result, so this is a missing test, not a wrong result. Same as debt D4 | Add tests for a restart and an exit while `check_update` is pending, and for a `shutdown` before `ContentInit` with a content entry, each asserting `release_count` 0 and the reverse-order module `release` | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | open | R1-1 | bootstrap_core.gd:161-164 still records the entry scene only when the module list is empty; no change in the range |
| D3 | open | R1-2 | Every `start_boot` of the tests still passes a non-empty list, and no test refers to the entry scene |
| D4 | open | R1-3 | No test halts in `Update` or asserts `content_release` after a `shutdown` before `ContentInit` |
| D5 | open | R1-2 | Same problem as D3: the destruction of the boot entry scene in `TitleScene` has no test |

## must fix

none

## unknown

- The commit range e02d2bf..e02d2bf has no commits, so no finding comes from changes; only the input debt items were checked.
- Tests were not run. R1-1 to R1-3 come from reading the code and tests; the run-time reproductions of D2 and D3 recorded in the input were not repeated.
