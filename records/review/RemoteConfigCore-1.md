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

- Range reach: `git diff 9b1e14b..b5f4253` has no change in `client/godot/core/remote_config_core`, the module folders of `LogCore`, `EventCore`, `TimeCore`, `DataCore`, `NetworkCore`, `AuthCore` and `UnitTestCore`, `client/godot/generated/data`, `client/godot/generated/contract`, `proto`, `server/core/remote-config`, `core-spec/RemoteConfigCore.json`, `core-spec/remote-config.json`, `tools/data-tool/src/checks/remote-config.ts`, `fixtures/remote-config-group.json` or the `remote_config_key` and `experiment` test data. The range changes that the module could meet (`tools/data-tool/src/corespec.ts`, `tools/data-tool/src/godotgen.ts`, `client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json`) were read: the `RemoteConfigCore.refreshIntervalMs` key is unchanged, and the generated `GameData` code is unchanged
- Tests run: `ogw core test godot RemoteConfigCore` (native run) passed at this checkout. The browser run (`ogw core test godot --web RemoteConfigCore`) was not run, and whether the pass was a new run or a kept result with the same key was not checked
- Not read in full: `skills/core/command.md`, the `## engine behavior` part of `skills/client-core/engines/godot.md`, and the dependency module specs. From the dependency specs, only the operations and events that the module uses were read: `TimeCore.get_real_time`, `AppForegroundReturnedEvent`, `AuthCore.get_login_remote_config`, `LoginCompletedEvent`, `AuthCore.is_logged_in`, `AuthCore` logout and account switch, `NetworkCore.send`, `DataCore.load`
- Run paths read in code but not run: a background return while logged in after `RemoteConfigCore.release` and `init` with no apply since. `RemoteConfigCore._on_foreground_returned` does not refresh there, and the spec does not set the elapsed time when there is no last apply. `BootstrapCore` was not traced to check whether this state can occur
- `test_getters_do_not_allocate` measures only `get_bool` with a received value, `get_int` with a default value and `get_string` with a received value. Whether the other paths and `get_group` allocate was checked only by reading the code, not by a test
