# review RemoteConfigCore round 1

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

- The commit range d4c3ae7..9991666 changes no RemoteConfigCore file: `git diff --name-only` is empty for `client/godot/core/remote_config_core/`, the client modules it depends on (`log_core`, `event_core`, `time_core`, `data_core`, `network_core`, `auth_core`), `server/core/remote-config/`, `server/core/auth/`, `proto/`, `settings/`, `fixtures/`, `test-data/`, `core-spec/RemoteConfigCore.json` and `core-spec/remote-config.json`. Input `## spec changes` is `none`. So I checked only whether the changes in the range reach RemoteConfigCore code or tests
- UICore: `client/godot/core/ui_core/ui_core.gd` only adds `is_dimmed`, `_is_dimmed` and `_dim_above` and changes two comments. Outside tests, the only caller of `is_dimmed` other than UICore itself is the DEV code `client/godot/core/qa_core/dev/qa_query.gd:271`. UICore is not a RemoteConfigCore dependency, and the RemoteConfigCore test base calls only `UICore.init` and `UICore.prepare` (`client/godot/core/remote_config_core/tests/support/remote_config_test_case.gd:63`, `:71`), which the range does not change
- Generated core settings: the only change to `client/godot/generated/core_settings.json` is removing `uiQuality.maxFlatShare`. No file under `client/godot/core/`, `client/godot/generated/`, `settings/`, `server/core/` or `tools/` mentions that key any more. `RemoteConfigCore.refreshIntervalMs`, the only key RemoteConfigCore reads, is unchanged (`client/godot/generated/core_settings.json:446`, `settings/core-settings.json:446`)
- I also read `remote_config_core.gd`, `remote_config_refresh.gd`, `remote_config_core_node.gd` and the four test files against the module spec and found no problem to write in `## out of scope`. This was a reading of the code, not a run, and it was not a whole-target review: the range does not change this code, so the procedure limits the review to what the changes reach. I did not trace how `refresh` behaves against `AuthCore` account switching inside `NetworkCore` and `AuthCore`
- I did not run the RemoteConfigCore tests. There is no finding to check, and they run through `ogw core test` and its test host, which this review did not start. The conclusions above about what the range does not reach come from the diff and from searching the code
- I did not review the new UICore and QACore tests (`client/godot/core/ui_core/tests/test_dimmed.gd`, `client/godot/core/qa_core/tests/test_list_ui.gd`), the correctness of `is_dimmed`, or the rest of the code the range changes; they belong to the reviews of those modules
- Of the defining documents, I read `remote-config-core.md` and `remote-config.md` (server) in full, and `core/SKILL.md` from its start through the settings constraint rule of `## core settings`. I only searched `auth-core.md`, `time-core.md`, `network-core.md`, `event-core.md`, `client-core/SKILL.md` and `client-core/engines/godot.md` for `RemoteConfig`, `get_login_remote_config`, `LoginCompletedEvent` and `AppForegroundReturnedEvent`. I did not read `log-core.md`, `data-core.md` or `core/command.md`. The range changes no code of those dependencies and input `## spec changes` is `none`, so I did not compare RemoteConfigCore with these documents again
