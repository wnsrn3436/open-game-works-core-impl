# review BootstrapCore round 1

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

- The commit range changes only `UICore` files (`client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd` and three `UICore` tests); no `BootstrapCore` file changed. Checked the `BootstrapCore` code that reaches the changed code: the boot failure, fatal and deletion code system popups (`client/godot/core/bootstrap_core/bootstrap_core.gd:1074`), `UICore.close_all_popups` on restart and fatal (`client/godot/core/bootstrap_core/bootstrap_core.gd:1195`), the reverse release that calls `UICore.release` (whose `_reset_statics` clears the new `_focus_start_pending`, `_start_focus_callable`, `_scroll_event`), and the test helper `press_popup_button` (`client/godot/core/bootstrap_core/tests/support/boot_test_support.gd:412`), which starts the focus mode with a direction key and presses a button with Tab and Enter. A `_start_focus` deferred call that runs after `UICore.release` returns at the `_is_initialized` check of `_update_focus`, and a restart starts the new boot in a later frame than that deferred call
- Ran the `BootstrapCore` core tests (`client/godot/core/bootstrap_core/tests/`) with GUT directly in a temporary copy of the core project, not through `ogw core test` (no test host, no per-run storage isolation): 121 of 123 passed. The two failures (`test_fatal_in_load_device_file_skips_the_init_modules_operations_after_it`, `test_fatal_in_load_volume_settings_skips_the_init_modules_operations_after_it` in `test_boot_fatal.gd`) also fail in the same way on a copy with the `UICore` files of `97851fcb`, and come from local data left by earlier tests in that run (`InputCore.key_bindings` stored with another type), so they were not judged as caused by the range. Their result under `ogw core test` was not checked
- Browser runs and render tests of `BootstrapCore` were not run
