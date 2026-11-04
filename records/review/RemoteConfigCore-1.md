# review RemoteConfigCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/remote_config_core/tests/test_values.gd:83: medium `test_getters_do_not_allocate` does not check the behavior `Getters do not allocate memory` of the spec: it compares the current values of `Performance.OBJECT_COUNT` and `Performance.MEMORY_STATIC` before and after the read loop, so an allocation freed before the second read is not seen. Run on Godot 4.7.2 headless with the same measurement, in a temporary script: a getter that builds `"x".repeat(1000)` on each call and a getter that makes a `RefCounted` and a `Dictionary` on each call both pass (objects 1480 -> 1480, static memory 24124650 -> 24124650). The test file is unchanged in the range, so this problem existed before it and is unrelated to its changes

## debt

none

## must fix

none

## unknown

- The commit range changes no file of RemoteConfigCore, of client LogCore, EventCore, TimeCore, DataCore, NetworkCore, AuthCore or of server `remote-config`. The client changes are only in `realtime_core`; the others are `server/core/auth`, `block-report`, `iap`, `routing/tests` and `settings/core-settings.schema.json`. In `server/core/auth/deps.ts` only the `remove_user` type of `block-report` changed, not the `RemoteConfig` interface, and the schema minimums changed by the range do not include `RemoteConfigCore.refreshIntervalMs`
- `ogw core test godot RemoteConfigCore` was not run: no finding needed it, and the range does not change the code that test runs
- The mutation of the out of scope line was not run inside the RemoteConfigCore test itself, because `ogw core test` runs only in a checkout under `worktrees/_core/` or in the main checkout. It was run with the same measurement in a temporary script outside the checkout
- Server `remote-config` and the client modules it depends on were read only where RemoteConfigCore calls them or where the range changed them. The data tool was read only in `tools/data-tool/src/checks/remote-config.ts`, and how a row whose `client` is `false` is left out of client data was seen only through the assert in the test support `remote_config_test_case.gd`
