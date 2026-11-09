# review GameUpdateCore round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | Commit 9f091370 adds `client/godot/core/game_update_core/tests/test_lifecycle.gd:158` `test_release_before_init_drops_the_set_downloader` and `:177` `test_release_after_release_drops_the_set_downloader`: `GameUpdateCoreDev.set_downloader(d)` while not initialized, `release()`, assert `_downloader_override` is null, `d` got no `cancel`, no error or warn log, and a following `init` uses the engine downloader of the runtime, not `d`. Restored the defect in a `git worktree add --detach` copy of cab65d84 by replacing `client/godot/core/game_update_core/game_update_core.gd:127` (`_downloader_override = null`) with `pass`: `ogw core test godot GameUpdateCore --file client/godot/core/game_update_core/tests/test_lifecycle.gd` reports `GameUpdateCore fail`, both new tests failing on `expected to equal [<null>]` for `_downloader_override` and `expected to not equal` for `_downloader`. With the line restored the same run reports `GameUpdateCore pass` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range changes only `client/godot/core/game_update_core/tests/test_lifecycle.gd` (two tests and the helpers `warns` and `_assert_engine_downloader`) and record files; only those tests, `game_update_core.gd` (`init`, `release`, `_drop_state`), `dev/game_update_core_dev.gd` and `tests/support/game_update_test_case.gd` were read
- Only `ogw core test godot GameUpdateCore --file .../test_lifecycle.gd` was run (on the restored copy and on cab65d84); the `--web` run, which takes the `_WEB_DOWNLOADER` branch of `_assert_engine_downloader`, and the whole GameUpdateCore and BootstrapCore suites were not run
- "No call to another module" during `release` before init is observed only through no error or warn log and no call on the set downloader, as the core agent report states; calls that leave no log are not observed. This was not written as a finding: `release` before init at `game_update_core.gd:125-128` has no call at all
