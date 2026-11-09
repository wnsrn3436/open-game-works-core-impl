# review fix GameUpdateCore round 3

## done

- GameUpdateCore (client, godot): added core tests in `client/godot/core/game_update_core/tests/test_lifecycle.gd` for the `release` of a GameUpdateCore that is not initialized. No implementation change: `game_update_core.gd:127` already deletes `_downloader_override`; the finding was the missing test
- No engine-specific implementation rules document written; `## <engine> build` of `tools/ogw.md` not written

## spec proposals

none

## review

- R3-1: fixed. Tests added: `client/godot/core/game_update_core/tests/test_lifecycle.gd:158` `test_release_before_init_drops_the_set_downloader` (`set_downloader(d)` with no `init`, `release()`; asserts `_downloader_override` is null, `d` got no cancel call, no error or warn log with LogCore initialized, and a following `init` uses the engine downloader of the runtime — HTTP downloader, or the fetch downloader in the browser runtime — not `d`) and `client/godot/core/game_update_core/tests/test_lifecycle.gd:177` `test_release_after_release_drops_the_set_downloader` (the same after an init and release). Checked against the defect: with `game_update_core.gd:127` replaced by `pass`, `ogw core test godot GameUpdateCore --file .../test_lifecycle.gd` reports both new tests failing; with the line restored they pass. Last runs on the commit: `ogw core test godot GameUpdateCore BootstrapCore QACore UnitTestCore` and the same with `--web`: all pass. `ogw code check core`: all pass

## unverified

- "No call to another module" during `release` before init is checked only through no log and no call on the set downloader; calls to other modules that leave no log are not observed by the test
