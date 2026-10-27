# review AuthCore round 7

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R7-1 | spec | medium | client/godot/plugins/ogw-secure-storage/build.sh:54 | The input spec change makes `open-game-works-core/skills/client-core/engines/godot.md:57` say all platforms are built on a Mac host: windows with the MinGW-w64 cross compiler (`x86_64-w64-mingw32-g++`), linux in a `debian:bullseye` Docker container per architecture the `.gdextension` names (`linux/amd64` for x86_64, `linux/arm64` for arm64). `build.sh` still follows the old rule (round 3 changed it to match the old godot.md:57): its header (build.sh:2-11) says linux is built on a Linux host of each architecture with the host glibc and windows on a Windows host from the MSYS2 MINGW64 shell; the `Darwin)` branch (build.sh:55-103) builds only android, macos and ios; the `Linux)` branch (build.sh:104-118) builds one architecture with the host toolchain and no container; the `MINGW64_NT*)` branch (build.sh:119-125) builds windows on a Windows host. Run path: `./build.sh <work>` on a Mac host, as godot.md:57 now requires, leaves `dist/windows/` and `dist/linux/` unchanged, so a change to `desktop/src/*.cpp` cannot be rebuilt into the committed windows and linux dists by the plugin's build script in the way the spec sets. The Mac-host MinGW and `debian:bullseye` steps existed in `build.sh` at f810092 (header lines 2-6, `LINUX_IMAGE`, the `docker run --platform` loop) and were removed in 9b5616b | Make the `Darwin)` branch of `build.sh` also build windows x86_64 with `use_mingw=yes` and the `x86_64-w64-mingw32-g++` cross compiler and each linux architecture in a `debian:bullseye` container of the matching `--platform`, and update the header; drop or reword the Linux-host and Windows-host branches | no | 92 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | The input spec change rewrites `open-game-works-core/skills/client-core/engines/godot.md:57` to build all platforms on a Mac host, windows with the MinGW-w64 cross compiler and linux in `debian:bullseye` containers per architecture. The committed dists match that: `dist/windows/addons/ogw-secure-storage/windows/libogw-secure-storage.windows.x86_64.dll` is a PE32+ x86-64 DLL containing `Mingw-w64 runtime failure:`, which the round 1 and round 3 fix reports state is the MinGW cross build on the Mac host; `dist/linux/addons/ogw-secure-storage/linux/libogw-secure-storage.linux.x86_64.so` (ELF x86-64, highest symbol version GLIBC_2.14) and `libogw-secure-storage.linux.arm64.so` (ELF aarch64, GLIBC_2.17) both contain `GCC: (Debian 10.2.1-6) 10.2.1 20210110`, the `debian:bullseye` toolchain, and `records/1793103070883-review-fix-mvqn9sbn23fe1c.md` `## done` third item states they were built in `debian:bullseye` containers on the Mac host (arm64 native, amd64 emulated). The two architectures are those that `ogw-secure-storage.gdextension` names (`linux.x86_64`, `linux.arm64`). The build script, which still follows the old rule, is the new finding R7-1. R2-1 is a `spec` finding, so no restoration was needed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range 7615340..b4aa10b changes only records (`records/review/AuthCore-6.md`, `records/review/AuthCore-6-runs.json`); the code read in this round is what the changed godot.md:57 reaches: `client/godot/plugins/ogw-secure-storage/build.sh`, `desktop/SConstruct`, the `.gdextension` files and the committed windows and linux dists, plus `build.sh` at f810092 and the round 3 fix report
- That the windows DLL was built with `x86_64-w64-mingw32-g++` on a Mac host and the linux libraries in `debian:bullseye` containers with `--platform linux/amd64` and `linux/arm64` rests on the fix reports and the toolchain strings in the binaries; the binaries were not rebuilt, and a toolchain string does not show the build host or the exact compiler driver name
- Whether godot-cpp commit `2bb1acf6f8ae1ce96ac7b9ba3a10b499c59c49ec` is on the godot-cpp branch of the `godot` version (godot.md:57) was not checked against the remote
- No core test was run: no code changed in the range, and the core tests run through `ogw core test`
- The AuthCore debt list holds D6 (`backend_windows.cpp:59`), which is not in this input, so it was not judged here
