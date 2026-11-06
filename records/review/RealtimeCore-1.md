# review RealtimeCore round 1

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

- The commit range 97851fcb..b3e9c2be changes no file under `client/godot/core/realtime_core/`, under the modules of its `## dependency` (`util_core`, `log_core`, `event_core`, `time_core`, `local_data_core`, `data_core`, `auth_core`, `network_core`) or under `server/` (`matchmaker`, `p2p-signaling`); `## spec changes` is `none`. The only code change is in `UICore` (`client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd`: the key direction input that starts the focus mode puts the focus deferred, and a system popup body scroll is consumed in unhandled input). RealtimeCore code does not call `UICore`, `MessageCore` or any input handling; only its test base `client/godot/core/realtime_core/tests/support/realtime_test_case.gd:128`, `:136`, `:57` calls `UICore.init`, `UICore.prepare` and `UICore.release`, whose changed parts are the new statics reset in `_reset_statics` and the input paths. No RealtimeCore test sends an input event (no `InputEvent`, `parse_input_event` or `Input.action` in `client/godot/core/realtime_core/`), so the changed input paths are not reached by the RealtimeCore tests. The rest of RealtimeCore code that existed before the range was not reviewed, because it is outside this range.
- The RealtimeCore core tests were not run: this checkout has no `client/godot/addons/` (GUT is not installed), and installing it would write files outside `output`. `ogw review run` runs the core tests of the modules that depend on the target.
