# review: BootstrapCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/bootstrap_core/bootstrap_core.gd:161: medium `start_boot` records the boot entry scene only when the module list is omitted, so a boot entry scene that passes a module list is never destroyed. `open-game-works-core/skills/client-core/modules/bootstrap-core.md:32` allows the boot entry scene to pass a list, and `bootstrap-core.md:67` says a successful `TitleScene` destroys that scene. Reproduced in a temporary copy of the target commit with a throwaway test: a new node set as `tree.current_scene`, then a boot with `_SUPPORT.modules()` up to `BootCompletedEvent` plus 3 frames, and the node is still valid. This is not caused by the commit range.
- client/godot/core/bootstrap_core/bootstrap_core.gd:450: medium no core test goes through the destruction of the boot entry scene. Every `start_boot` of the core tests passes a non-empty list (`tests/support/boot_test_support.gd:266`, `tests/test_boot_order.gd:247`, `tests/test_boot_dev_run.gd:188`), so `_boot_entry_scene` stays `null`. In a temporary copy of the target commit, replacing `_boot_entry_scene.queue_free()` with `pass` still gives `ogw core test godot BootstrapCore` pass on the native run. This is not caused by the commit range.
- client/godot/core/bootstrap_core/tests/test_boot_exit.gd:76: medium `open-game-works-core/skills/client-core/modules/bootstrap-core.md:266` requires that `content_release` is not called on a restart or app exit during `Update` and on a `shutdown` before `ContentInit`, and no test covers these three cases. The tests assert `release_count` 0 only for an update reboot (`tests/test_boot_restart.gd:156`), a restart in `TitleScene` (`tests/test_boot_restart.gd:171`) and an exit in `TitleScene` (`tests/test_boot_exit.gd:85`). No test halts in `BootStage.UPDATE`, and no test that calls `shutdown` before `ContentInit` asserts `content_release`. By reading, the implementation guard `_content_inited` (`client/godot/core/bootstrap_core/bootstrap_core.gd`, `_reverse_release` and `_shutdown`) gives the required result, so this is a missing test and not a wrong result. This is not caused by the commit range.

## debt

none

## must fix

none

## unknown

- Scope of the commit range: it changes no file under `client/godot/core/bootstrap_core/` and no spec. Its only implementation change is `_restore_heading_types` of `LocalizationCore` (`client/godot/core/localization_core/localization_core.gd:714`), which `BootstrapCore` reaches through `LocalizationCore.release` in reverse release and `shutdown`.
- How that path was checked: a throwaway test in a temporary copy of the target commit, with a theme style based on each of `HeadingLabel`, `HeadingButton` and `HeadingRichTextLabel`. Through restart (twice), update reboot, `shutdown` followed by a new boot, `ExitConfirmedEvent`, a restart during `LoadData`, and a restart from a fatal popup state, the styles keep their base, and after each boot that reached `Done` they draw with the heading font of the theme. That run passes. With the removed `Theme.remove_type` branch restored, 5 of the 6 tests fail. `test_restart_during_load_data_then_done_keeps_the_style` still passes with that branch, so it says nothing about this change. The throwaway test is not in the target.
- `ogw core test godot BootstrapCore` and `ogw core test godot BootstrapCore --web` pass on the target commit. Both results were reused from a passing result of the same key, not run again. The throwaway and mutated runs were native only, because `--file` is not used with `--web`, and the temporary copies are deleted.
- The omitted module list path of `start_boot` (`_generated_modules`, and the boot entry scene being recorded and destroyed) was not run. The core tests do not reach it, and a run of it in a game or in the benchmark game was not done here.
- The core test runs on the engine default theme. A project theme whose styles are based on heading types was not run through `BootstrapCore`.
- `open-game-works-core/skills/client-core/modules/bootstrap-core.md:127` counts a termination signal as an exit request, and `open-game-works-core/skills/client-core/engines/godot.md:277` handles app exit through `NOTIFICATION_WM_CLOSE_REQUEST`. Whether the engine delivers that notification for a termination signal was not checked.
- STG and PROD exported builds were not run. The behavior without DEV code was checked only by what the tests of the target cover (`test_build_without_dev_entry_has_no_launch_values_fake_adapters_or_dev_calls`).
- `bootstrap_core.gd` and the DEV code were read in full to look for out of scope problems. The test files were read by test name and at the places cited above, so the asserts of the other tests were not checked one by one.
- The modules of `ogw core dependents BootstrapCore` were not run here.
