# review AuthCore round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | client/godot/plugins/ogw-secure-storage/build.sh:70 | The build method in `open-game-works-core/skills/client-core/engines/godot.md:57` says windows is built on a Windows host and linux on a Linux host. `build.sh` builds every dist on a Mac host: windows with `scons ... use_mingw=yes` and the MinGW-w64 cross compiler (build.sh:5, 69-75), linux in `debian:bullseye` Docker containers run on the Mac host (build.sh:13, 80-91). The committed `dist/windows/addons/ogw-secure-storage/windows/libogw-secure-storage.windows.x86_64.dll` and `dist/linux/addons/ogw-secure-storage/linux/libogw-secure-storage.linux.{x86_64,arm64}.so` came from that script (fix report `records/1793100609171-review-fix-mvqlt0ur714049.md` `## done` and `## spec proposals` first item, which states that the rule was not followed) | Rebuild the windows dist on a Windows host and the linux dists on a Linux host as godot.md:57 says, and make `build.sh` (or a per-host script) do that; or get the spec proposal of the fix report accepted and change godot.md:57 first | no | 90 |
| R2-2 | spec | medium | client/godot/plugins/ogw-secure-storage/desktop/src/backend_linux.cpp:162 | godot.md:420 makes a run with DEV code that has no `ogw-secure-storage` singleton use DEV token storage, and defines that run as "a process that cannot use OS secure storage" (on macOS the singleton is registered only when the process can use the keychain, godot.md:41). On Linux, `backend::available()` is only "libsecret-1.so.0 and its symbols load" (backend_linux.cpp:60-92, 162-169), so `register_types.cpp:22-26` registers the singleton also in a process that has no Secret Service or no default collection; there every operation is `STATUS_UNSUPPORTED` (backend_linux.cpp:110-116, 121-124). Run path: Linux host with libsecret installed and no reachable Secret Service default collection (SSH or headless session, CI container), dev run or DEV build started by BootstrapCore, which calls `use_dev_token_storage` (client/godot/core/bootstrap_core/dev/bootstrap_core_dev.gd:117-119). `AuthCore._platform_storage` (client/godot/core/auth_core/auth_core.gd:243) sees `is_available()` `true` and picks `secure_storage_adapter.gd`; without the install marker the delete of the storage item is `Unsupported`, which is a check failure (auth-core.md:140), and with the marker the read is `Unsupported`, which is `Failed` (auth-core.md:94). So `boot_login` is `Failed` on every launch. Before this range `linux` was not in the `engine.json` item, the run had no singleton, and DEV token storage was used. The fix report `## unverified` reproduced the `UNSUPPORTED` result with a session bus without a default collection and the singleton being registered whenever libsecret loads | Register the Linux singleton only when the process can use Secret Service (service reachable and a default collection exists), as the macOS build gates the singleton on a keychain access group; or settle the Linux condition in godot.md:41 and :420 first (fix report `## spec proposals` second item) | no | 80 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/engine.json:56-64` lists `android`, `ios`, `macos`, `windows`, `linux`. Each target platform has its build under `client/godot/plugins/ogw-secure-storage/dist/<platform>/` at the paths godot.md:56 sets: android `addons/ogw-secure-storage/{plugin.cfg,ogw_secure_storage_export.gd,android/ogw-secure-storage-release.aar}` (the AAR holds `OgwSecureStoragePlugin` with `start_read`, `start_write`, `start_remove`, `take_result`, `cancel` and manifest key `org.godotengine.plugin.v2.OgwSecureStorage`), ios `ios/plugins/ogw-secure-storage/` (`.gdip` with `binary` `ogw-secure-storage.xcframework`, debug and release xcframeworks with device and simulator slices), windows and linux `addons/ogw-secure-storage/` with the `.gdextension` and libraries for `windows.x86_64`, `linux.x86_64`, `linux.arm64`. The singletons return `[status, text]` with the `TokenStorage.Status` values (`desktop/src/backend.h:13-17`, `ios/src/ogw_secure_storage.h`, `OgwSecureStoragePlugin.java:42-44`), which `secure_storage_adapter.gd:_outcome` reads. iOS and Windows always register the singleton, so STG and PROD builds there no longer get `UNSUPPORTED` for every operation. The remaining Linux case where the singleton is present but unusable is R2-2. `test_secure_storage_plugin.gd` checks the item platforms and each dist; R1-1 is a `spec` finding, so no restoration was needed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only commit f810092 of the range changes AuthCore (the `ogw-secure-storage` android, ios, windows and linux sources and dists, `engine.json`, `licenses.json`, `test_secure_storage_plugin.gd`). The other commits of the range change server modules, QACore and records, and were not read
- No native code was run. The Android AAR (Keystore key creation, AES-GCM, `noBackupFilesDir` exclusion), the iOS library, the Windows DLL (Credential Manager) and the Linux libraries were checked only by reading the source against godot.md:41, :59 and auth-core.md `### login token storage`, plus the AAR class listing (`javap`). There is no Android device, iOS device or Windows host here
- Windows `backend::available()` is always `true` (backend_windows.cpp:59-61), while `ERROR_NO_SUCH_LOGON_SESSION` maps to `UNSUPPORTED` (backend_windows.cpp:46-47). Whether a dev run in a Windows logon session without a credential set (service or network logon) is a case that the loop or core tests use was not checked, so it is not written as a finding
- Whether the committed windows and linux binaries were built from the committed source was not checked (no rebuild was run). Whether godot-cpp commit `2bb1acf6f8ae1ce96ac7b9ba3a10b499c59c49ec` is on the Godot 4.7 branch was not checked against the remote
- The `engine.json` item and godot.md:41 name platforms but not architectures; a windows arm64 or linux x86_32 export has no library. Not written as a finding because no defining document sets the architectures
- How `ogw build run` enables the Android export plugin `addons/ogw-secure-storage/plugin.cfg` and links the iOS `.gdip` belongs to the `build` skill, outside this target, and was not checked
- When an OS call of a storage operation does not return, the next operation waits behind it on the plugin's single operation thread or serial queue (all platforms, including the macOS build from before this range), although `AuthCore.storageCallTimeoutMs` (auth-core.md:297) says the next operation starts after the time limit. Whether this conflicts with "Storage operations run one at a time" (auth-core.md:132) was not settled, so it is not written as a finding
- The core tests were not run: `client/godot/addons/` is absent from this checkout, and the tests run through `ogw core test`, which puts the plugins in first. Whether any BootstrapCore or QACore core test reaches `boot_login` with the platform storage on a Linux host with libsecret and no Secret Service was not checked
