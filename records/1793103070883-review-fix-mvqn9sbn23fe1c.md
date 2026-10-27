# review fix AuthCore round 2

## done

- `ogw-secure-storage` Linux singleton (R2-2): `desktop/src/backend_linux.cpp` `backend::available()` is now true only when libsecret and its symbols load and, once at library load, the session's Secret Service gives a default collection (`open_collection` returns the collection, or `STATUS_DENIED` for a locked one). No session bus, no Secret Service, or a Secret Service without a default collection gives no singleton, so a run with DEV code uses the DEV token storage (godot.md:420). A locked default collection still registers the singleton: it exists, and operations give `DENIED` without an unlock window, as before. Comments of `backend.h` and `register_types.cpp` follow it
- `client/godot/plugins/ogw-secure-storage/build.sh` (R2-1, script part): builds only the platforms of the host it runs on, as godot.md:57 says. Mac host: android, macos, ios. Linux host: the linux library of the host's architecture (x86_64 or arm64; each architecture on a Linux host of that architecture). Windows host: windows x86_64 from the MSYS2 MINGW64 shell (MinGW-w64, so the `licenses.json` items `MinGW-w64 winpthreads` and `GCC runtime libraries` still describe the result). Other hosts stop with a message. A run replaces only what it builds in `dist/`. The Docker linux build and the MinGW cross build on a Mac host are removed from the script
- `dist/linux/addons/ogw-secure-storage/linux/libogw-secure-storage.linux.{x86_64,arm64}.so` rebuilt with the R2-2 change, by the Linux branch of the new `build.sh` run inside `debian:bullseye` containers (arm64 native, amd64 emulated) on this Mac host. See `## review` R2-1: this is not a Linux host. Symbols unchanged in shape: export `ogw_secure_storage_init`, NEEDED `libdl`, `libm`, `libpthread`, `libc` (+ `ld-linux-x86-64` for x86_64), highest glibc symbol GLIBC_2.17 (arm64) and GLIBC_2.14 (x86_64), no host paths in the binaries. `.gdextension` and the other dists unchanged
- Core test `client/godot/core/auth_core/tests/test_secure_storage_plugin.gd` `test_a_run_with_the_plugin_singleton_can_use_the_os_secure_storage`: when the run has the `OgwSecureStorage` singleton, a read of a missing item through `secure_storage_adapter.gd` ends with neither `UNSUPPORTED` nor `FAILED`. Without the singleton the test passes by skipping
- No per-engine rules document was written

## spec proposals

- Same as the first item of the round 1 fix report, still open: godot.md:57 requires a Windows host for windows and a Linux host for linux. This host has neither, so the committed windows DLL (MinGW cross build) and the linux libraries (Debian 11 containers on a Mac host) are not built as godot.md:57 says. Proposal: allow the MinGW-w64 cross build on a Mac host and Linux containers (named image `debian:bullseye`, which sets the lowest glibc), or keep the rule and have the windows and linux dists rebuilt with the new `build.sh` on those hosts
- godot.md:41 and :420 do not state the Linux singleton condition. Proposal: add to the `ogw-secure-storage` row "On Linux the singleton is registered only when the session's Secret Service has a default collection (checked once when the library loads)", which is what this fix does

## review

- R2-2: fixed. `client/godot/plugins/ogw-secure-storage/desktop/src/backend_linux.cpp:162-177` (`available()` probes `open_collection` once). Rebuilt linux libraries in `dist/linux/`. Added test `test_a_run_with_the_plugin_singleton_can_use_the_os_secure_storage` (`client/godot/core/auth_core/tests/test_secure_storage_plugin.gd`). Cause reproduced and fix checked in a `debian:bookworm` arm64 container with Godot 4.7.2 headless loading the arm64 `.so`, old build vs new build:
  - libsecret installed, no session bus: old `singleton true`, read `["3", ""]` (UNSUPPORTED); new `singleton false`
  - session bus with D-Bus-activated gnome-keyring and no default collection (the finding's run path): old `singleton true`, read `["3", ""]`; new `singleton false`
  - no libsecret: both `singleton false`
  - unlocked default collection: both `singleton true`; read/remove missing → NOT_FOUND, non-ASCII write/read round trip, overwrite, queued write-then-read order, cancel, unknown ID, empty name, empty text, persistence across runs all as in round 1
  - locked default collection: both `singleton true`, read, write, remove → `DENIED`, no prompt
- R2-1: not fixed, partly done. `build.sh` now builds each platform on the host godot.md:57 names (see `## done`). The windows and linux dists could not be rebuilt on a Windows host and a Linux host: this host is a Mac (arm64) with no Windows or Linux machine or VM (only Docker Desktop). The linux libraries had to be rebuilt for R2-2, so they were again built in Linux containers on this Mac host, with the new script's Linux branch. The windows DLL is unchanged (Mac MinGW cross build from round 1; `backend_windows.cpp` did not change). To close R2-1, either run `build.sh` on a Linux x86_64 host, a Linux arm64 host and a Windows host and commit the resulting `dist/linux/` and `dist/windows/`, or accept the first spec proposal
- Code check result of the input: all `pass` except `fix test proof` `unknown` (round 1 changed only test files of AuthCore); nothing to fix

## unverified

- The Linux and Windows branches of `build.sh` were not run on real Linux or Windows hosts. The Linux branch ran only inside `debian:bullseye` containers (arm64 native, x86_64 under emulation). The Windows branch (MSYS2 MINGW64, `uname -s` `MINGW64_NT*`) was not run at all
- The rebuilt linux x86_64 `.so` was not loaded by Godot; only its NEEDED list, glibc symbol versions and export were checked. Runtime checks were done with the arm64 `.so` only
- The new core test was run only on macOS, where the core test run has no singleton, so it took the skip branch. It was not run on a Linux host. Its check (singleton present ⇒ read is not `UNSUPPORTED`) was reproduced by the container runs above (old build: singleton with read `UNSUPPORTED`; new build: no singleton)
- `available()` now makes a D-Bus call to Secret Service once when the library loads (main thread, scene initialization). On a session where Secret Service activation hangs, startup waits for the D-Bus call time limit of libsecret/GLib. Not measured
- KDE Wallet and KeePassXC Secret Service providers were not tried
- Windows: the `ERROR_NO_SUCH_LOGON_SESSION` → `UNSUPPORTED` case in the review's `## unknown` is not changed; on such a Windows session the new test would fail
- Core tests: AuthCore and its dependents (AdCore, BootstrapCore, PaymentCore, PushCore, QACore, RealtimeCore, RemoteConfigCore, TutorialCore, UnitTestCore) pass on `godot --web`. On `godot` all pass except native QACore, which is `skipped` because the macOS screen is locked (render pass not run), so the native job exit code is 1
- `ogw code check core`: pass (type check, lint, dependency, secret)
