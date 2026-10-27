# review AuthCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | high | client/godot/engine.json:56 | The new `plugins` item `ogw-secure-storage` has `platforms` `["macos"]`, and `client/godot/plugins/ogw-secure-storage/` has only `macos/` source and `dist/macos/`. The target platforms in `open-game-works-core/skills/client-core/engines/godot.md:41` are `android`, `ios`, `macos`, `windows`, `linux`. The release condition in `open-game-works-core/skills/core/command.md:30` asks for build results only for the platforms in that list, so a release passes without the other four builds, and `ogw build run` (godot.md:106) puts no plugin into those builds. Run path: in an STG or PROD build for `android`, `ios`, `windows` or `linux`, `CoreBuildInfo.has_dev_code` is `false`, so `AuthCore._platform_storage` (`client/godot/core/auth_core/auth_core.gd:240-245`) returns `secure_storage_adapter.gd`. There is no `OgwSecureStorage` singleton, so every `read_item`/`write_item`/`remove_item` gives `UNSUPPORTED` (`client/godot/core/auth_core/adapters/secure_storage_adapter.gd:15-38`). The install marker check, which deletes the storage item, then fails, and `boot_login` is `Failed` on every launch of those builds (auth-core.md:140 and the install marker error row) | Add the `android`, `ios`, `windows` and `linux` plugin sources and their `dist/<platform>/` builds as godot.md:41, 56 and 57 describe, and list all five platforms in the `engine.json` item | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The AuthCore changes in the range are commit 6a76444 (`ogw-secure-storage` macOS plugin, its `engine.json` item and licenses entry, and `client/godot/core/auth_core/tests/test_secure_storage_plugin.gd`). The rest of the range changes server modules, QACore, README and records, which this review did not read. In AuthCore, only the code that the change calls was read: `adapters/secure_storage_adapter.gd`, `adapters/token_storage.gd`, `auth_storage_queue.gd`, `AuthCore._platform_storage`/`init`/`release`, `AuthCoreDev.use_dev_token_storage` and `tests/support/auth_test_env.gd`
- The native code of the macOS plugin (`ogw_secure_storage.mm`, `register_types.mm`) was checked only by reading it against godot.md:41, 59, 65, 420 and auth-core.md `### login token storage`. Its keychain operations (item attributes `kSecUseDataProtectionKeychain`, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, not synchronizable; status mapping; the add-then-update write; the result and cancel handling) have no automated test, because only a process signed with a keychain access group gets the singleton, and the Godot editor that runs core tests has none. Behavior in a signed app with an embedded provisioning profile was not run
- Whether the committed `dist/macos/.../libogw-secure-storage.macos.dylib` was built from the committed source was not proven. The checks were: universal x86_64/arm64, `minos 11.0` in both slices, it contains the strings `keychain-access-groups`, `com.apple.application-identifier` and `ogw-secure-storage`, and it contains no `/Users` paths
- Whether godot-cpp commit `2bb1acf6f8ae1ce96ac7b9ba3a10b499c59c49ec` is on the godot-cpp branch of Godot 4.7 (godot.md:57) was not checked against the remote. It is the same commit that `ogw-native-ui/build.sh` uses
- Whether a game's macOS STG and PROD export embeds a provisioning profile that grants a keychain access group was not checked. Without one, the singleton is absent and login token storage is `UNSUPPORTED` on macOS too. That export belongs to the `build` skill, which is outside this target
- The AuthCore tests, including `test_secure_storage_plugin.gd`, were not run. `client/godot/addons/` is absent from this checkout, and the tests run through `ogw core test`, which puts the plugins in first
