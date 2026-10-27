# review AuthCore round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | open | `client/godot/plugins/ogw-secure-storage/build.sh:54-130` now builds only the platforms of its host (Darwin: android, macos, ios; Linux: the linux library of the host architecture; `MINGW64_NT*`: windows), which matches the build method of `open-game-works-core/skills/client-core/engines/godot.md:57`. The committed dists still do not: the fix report `records/1793103070883-review-fix-mvqn9sbn23fe1c.md` `## done` third item and `## review` R2-1 state that `dist/linux/addons/ogw-secure-storage/linux/libogw-secure-storage.linux.{x86_64,arm64}.so` were rebuilt in `debian:bullseye` containers on the Mac host, and that `dist/windows/addons/ogw-secure-storage/windows/libogw-secure-storage.windows.x86_64.dll` is still the MinGW cross build on the Mac host from round 1. godot.md:57 says windows is built on a Windows host and linux on a Linux host, and input `## spec changes` is `none`, so the spec proposal of the report is not applied |
| R2-2 | fixed | `client/godot/plugins/ogw-secure-storage/desktop/src/backend_linux.cpp:164-181`: `available()` is true only when libsecret and its symbols load and `open_collection` (`:109-134`) returns the default collection or `STATUS_DENIED` (locked). No session bus or no Secret Service (`service_get_sync` null, `:112-118`) and no default collection (`collection_for_alias_sync` null without error, `:123-126`) give `false`, so `register_types.cpp:22-24` registers no singleton, `secure_storage_adapter.gd:is_available` is `false`, and `AuthCore._platform_storage` (`client/godot/core/auth_core/auth_core.gd:240-245`) picks the DEV token storage in a run with DEV code that called `use_dev_token_storage`, as godot.md:420 says. The result is computed once (`tried`) before any operation thread exists, so it has no concurrent caller. The committed linux `.so` files changed in this range (`git diff --stat`, same size, new content). R2-2 is a `spec` finding, so no restoration was needed |

## out of scope

- client/godot/plugins/ogw-secure-storage/desktop/src/backend_windows.cpp:59: medium On Windows `backend::available()` is always `true`, so `register_types.cpp:22-26` registers the singleton also in a logon session without a credential set (network logon, e.g. an OpenSSH session with key authentication, or a service logon), where `CredReadW`/`CredWriteW`/`CredDeleteW` fail with `ERROR_NO_SUCH_LOGON_SESSION` and every operation is `STATUS_UNSUPPORTED` (`backend_windows.cpp:45-47`, whose comment names that case). In a dev run with DEV code there, `AuthCore._platform_storage` (`auth_core.gd:243`) sees the singleton and picks `secure_storage_adapter.gd` instead of the DEV token storage that godot.md:420 sets for "a process that cannot use OS secure storage"; the install marker delete is then `Unsupported`, a check failure (auth-core.md:140), or the read is `Unsupported`, which is `Failed` (auth-core.md:94), so `boot_login` is `Failed` on every launch. This is the Windows form of R2-2. The code is from before this range; this range's new test `test_a_run_with_the_plugin_singleton_can_use_the_os_secure_storage` (`client/godot/core/auth_core/tests/test_secure_storage_plugin.gd:47-61`) and its header (`:5-6`, "On every platform a run that has the singleton can use the OS secure storage") state the property this breaks, and the fix report `## unverified` says the test would fail on such a session

## debt

none

## must fix

none

## unknown

- The range changes AuthCore only in commit 9b5616b (`backend_linux.cpp`, `backend.h`, `register_types.cpp`, `build.sh`, the linux `.so` files, `test_secure_storage_plugin.gd`); c56760b and the merge and run-log commits change only records, which were read only for the fix report
- No native code was run and no container run was repeated. The fix report's reproduction (Godot 4.7.2 headless in `debian:bookworm` arm64, old vs new `.so`: no session bus, session bus without default collection, unlocked and locked default collection) was not rerun here. Whether the committed linux `.so` files were built from the committed `backend_linux.cpp` was not checked by rebuilding
- `available()` now makes the first `secret_service_get_sync` call on the main thread at scene initialization, so the `SecretService` that libsecret caches is created there and later used by the operation thread. libsecret's thread rules for that shared instance were not checked against its source; the report's container runs of read, write, remove and cancel after load passed
- A transient failure at library load (e.g. a D-Bus timeout while the Secret Service is being activated, which `open_collection` maps to `STATUS_FAILED`) now leaves the process without the singleton until restart, so in an STG or PROD Linux build every storage operation of that process is `Unsupported`, where before each operation tried again. No defining document sets the Linux singleton condition (fix report `## spec proposals` second item), and whether this load-time failure happens in practice was not reproduced, so it is not written as a finding. The startup wait for that D-Bus call was not measured
- The new core test was not run: `client/godot/addons/` is absent from this checkout and the core tests run through `ogw core test`. On the macOS host of the core tests it takes the skip branch, so it checks the Linux condition only when the core tests run on a Linux host with a usable or unusable Secret Service
- The Linux and Windows branches of `build.sh` were only read; they were not run on a Linux host or in an MSYS2 MINGW64 shell
