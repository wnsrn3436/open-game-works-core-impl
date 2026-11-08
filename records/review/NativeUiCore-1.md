# review NativeUiCore round 1

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

- The commit range 85f6b36d..be55f330 changes no file under `client/godot/core/native_ui_core/` and no `NativeUiCore.*` settings key (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings.json`). The dependency changes in the range were read for effects on NativeUiCore: `client/godot/core/log_core/log_core.gd` (comments only), `client/godot/core/time_core/time_core.gd` and `client/godot/core/time_core/dev/time_core_dev.gd` (`make_random_seed`, DEV frame step, which change the real and game frame increments but not `get_device_time`, nor the background and foreground events NativeUiCore subscribes to). No change to `EventCore`, `LocalDataCore`, `UICore` or `BootstrapCore` is in the range. No finding comes from them
- The module code (`native_ui_core.gd`, `native_ui_core_node.gd`, `native_ui_wait.gd`, the adapters, the DEV code) and the test list were read against the spec; no problem of severity `medium` or higher was found to write in `## out of scope`
- Core tests were not run: no code of the target changed in the range, and no finding needed a run to check it. The render pass behaviors (`capture_screen` frame and `Debug` layer timing, clipboard) and the browser runtime and native plugin paths were checked by reading only
