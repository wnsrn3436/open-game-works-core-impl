# review NetworkCore round 1

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

- The commit range 51d323b4..ebc957c changes no file under `client/godot/core/network_core/` and does not change `core-spec/NetworkCore.json`. Among its dependencies, only `UICore` (`client/godot/core/ui_core/`) and `MessageCore` (`client/godot/core/message_core/message_core.gd`) changed; `LogCore`, `EventCore`, `TimeCore`, `DataCore`, `UserStateCore`, `InputBlockCore` did not. Server `session` did not change. Server `routing` (`server/core/routing/http.ts`, `pipeline.ts`) and `logging` (`server/core/logging/log_line.ts`) changed only client IP parsing and IP truncation, which NetworkCore headers and `ReportClientErrors`/`ReportAnalyticsEvents` do not use
- Checked the effect of the `UICore.open_system_popup` change (it now loads the open and close tween presets of the system popup prefab before it shows, `client/godot/core/ui_core/ui_core.gd:529-541`) on NetworkCore `_retry_popup` (`client/godot/core/network_core/network_core.gd:1076-1093`) and `_open_popup` (`network_core.gd:1059-1060`). A load cancelled by `close_all_popups` goes through `_fail_open`, which cancels the waiter (`call_waiter.gd` `cancel` emits `done`), so `open_system_popup` returns `false` and the retry popup path ends as a failure with the note at `network_core.gd:920-923`. A `UICore` release during the load changes the `UICore` session, so it returns `false` the same way. The hidden callback is not called on `_fail_open`, so `_retry_popup` does not fire twice. `UICore.get_block_pass_list`, `show_loading_icon`, `hide_loading_icon` did not change
- Checked the `MessageCore.show_toast` change: only toast and black box object borrowing and log placement changed. The `show_toast` call of `network_core.gd:1038` is unaffected
- Ran `ogw core test godot NetworkCore`: pass
- The code of NetworkCore outside what the changes of this range reach was not audited again, because there is a commit range and the range has no NetworkCore change
- Did not check NetworkCore with a `UICore.systemPopupResource` prefab that has tween presets (the new async path of `open_system_popup`). No NetworkCore test uses one, and the NetworkCore spec sets no behavior that depends on it
