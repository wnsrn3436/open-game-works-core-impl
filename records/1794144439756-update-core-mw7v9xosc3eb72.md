## done

- BootstrapCore (godot): a launch value file that is not JSON or is not a JSON object is now a launch value check failure, fatal in `InitModules` 1, the same as a value that is not a JSON string. This covers the command line or page file and `res://generated/launch_values.json`. Before, it logged an error and booted without the file's values. The file is now parsed with `JSON.new().parse` and the first error is kept in `_launch_value_error` (`client/godot/core/bootstrap_core/dev/bootstrap_core_dev.gd` `_merge_launch_values`). Doc comments now follow the new `res://generated/launch_values.json` rule (read whenever it exists).
- Tests added (`client/godot/core/bootstrap_core/tests/test_boot_launch_values.gd`): `test_launch_value_file_that_is_not_json_is_fatal`, `test_launch_value_file_that_is_a_json_array_is_fatal`, `test_export_launch_value_file_that_is_not_a_json_object_is_fatal`.
- Shell and export-file rules (item 2): checked against the code with no changes. `core/web/ogw-shell.html` `preloadLaunchValues` rejects a parameter that is not a same-origin URL path, and a fetch that is not ok, and `displayFailureNotice` then runs without `startGame`. The engine file system path is the shell's constant `/tmp/ogw_launch_values.json`. `_read_launch_values` reads `res://generated/launch_values.json` whenever it exists.
- Runs: `ogw core test godot BootstrapCore QACore UnitTestCore` and the same run with `--web` both pass (QACore and UnitTestCore are the modules `ogw core dependents BootstrapCore` lists). `ogw code check core` passes (type check, lint, dependency, secret).
- No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written.

## spec proposals

none

## review

none

## unverified

- A launch value file path given on the command line that does not exist still gives no values and is not fatal. The spec does not cover a missing file, so that behaviour is unchanged.
