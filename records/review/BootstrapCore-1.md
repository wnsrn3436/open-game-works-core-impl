# review BootstrapCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/bootstrap_core/bootstrap_core.gd:449: medium The `TitleScene` behavior "On success, destroys the boot entry scene" of the spec table has no test. `_boot_entry_scene` is set only in the `modules.is_empty()` branch of `start_boot` (bootstrap_core.gd:161-164), every `start_boot` call in client/godot/core/bootstrap_core/tests passes a module list, and no test in that folder refers to the entry scene (a search for `entry scene`, `entry_scene` and `queue_free` has no match). Removing the `queue_free` at line 450 would therefore fail no BootstrapCore test (read from the code, not run). This predates the range: the range changes only the type declarations of two test variables.

## debt

none

## must fix

none

## unknown

- `ogw core test godot BootstrapCore` passed, with job output `BootstrapCore pass` and `BootstrapCore pass (reused)`. The second line is a reused result, so only one of the two runs executed in this review.
- Range changes in other modules were checked only for their effect on BootstrapCore: `LocalizationCore.list_languages`, `MessageCore.show_black_box`, the settings checks removed from `QACore` init, the `PaymentCore` comment and the generated settings files. BootstrapCore does not call `list_languages`. Its one `show_black_box` call (test_boot_restart.gd:108) passes one argument and fits the new signature. The other behavior of those modules belongs to their own reviews.
- The range changes to server code, tools and records (`server/core`, `tools/`, `records/`, `core-spec/` of server modules) were not read beyond the file list, because BootstrapCore does not reach them.
- Code outside the range was read for `## out of scope` only at the level of reading `bootstrap_core.gd`, `bootstrap_core_node.gd`, `update_set.gd`, `dev/bootstrap_core_dev.gd` and `bootstrap_dev_hooks.gd` against the spec. No test was written or run to reproduce behavior beyond the existing suite. The test files other than the changed lines and the lines cited here were not read in full, so whether each item of the spec `## test` has a test was not checked.
- The exit request by a termination signal of the spec was not checked at run time. The code handles only `NOTIFICATION_WM_CLOSE_REQUEST`, which is what godot.md sets for app exit. Whether the engine turns a termination signal into that notification on each platform was not checked.
- Real adapters and STG or PROD builds were not run.
