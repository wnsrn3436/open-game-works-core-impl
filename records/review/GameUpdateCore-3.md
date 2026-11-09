# review GameUpdateCore round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | client/godot/core/game_update_core/game_update_core.gd:127 | Commit ad967246 makes `release` of a GameUpdateCore that is not initialized delete `_downloader_override`, the value that the DEV operation `GameUpdateCoreDev.set_downloader` sets before `init` (`skills/core/SKILL.md:73` in the harness repo; `game-update-core.md` `## DEV`). No test covers it: `client/godot/core/game_update_core/tests/` has no test that calls `set_downloader`, then `release` without `init`, and then checks the override is gone (`test_lifecycle.gd:test_lifecycle` checks `_downloader_override` only after the `release` of an initialized module, which goes through `_drop_state` at `game_update_core.gd:251`), and `client/godot/core/bootstrap_core/tests/test_boot_shutdown_pre_init.gd` only checks DataCore and ResourceCore. Run path: in a `git worktree add --detach` copy of 23360e1c with lines 126-127 (the comment and `_downloader_override = null`) removed, `ogw core test godot GameUpdateCore` reports `GameUpdateCore pass`. With the defect, `GameUpdateCoreDev.set_downloader(fake)`, `GameUpdateCore.release()`, `GameUpdateCore.init()` keeps using `fake` instead of the engine HTTP client, so a downloader set by one test reaches the next test after the DEV `shutdown` | Add a GameUpdateCore lifecycle test: `set_downloader(d)` without `init`, `release()`, assert `_downloader_override` is null and that a following `init` without `set_downloader` uses the engine HTTP downloader (not `d`), with no log and no call to another module, as the NoticeCore and NetworkCore lifecycle tests of the same range do | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only the GameUpdateCore change of the range was read: `client/godot/core/game_update_core/game_update_core.gd` (`init`, `release`, `_drop_state`), `dev/game_update_core_dev.gd`, `tests/test_lifecycle.gd` and `tests/support/game_update_test_case.gd`, and the BootstrapCore `_shutdown` / `_release_entry` change that now calls `GameUpdateCore.release` while it is not initialized. The other files changed in the range belong to other review targets and were not reviewed
- The round 2 review had no `## findings` rows and no `open` `## previous` rows, so `## previous` has no rows to judge
- The core test replacements `_url_opener`, `_page_script_runner`, `_file_hasher` and `_file_writer` are set by tests directly, not by an operation, so the rule of `skills/core/SKILL.md:73` was not applied to them
- Only `ogw core test godot GameUpdateCore` was run, on the restored copy; the `--web` run and the BootstrapCore tests were not run
