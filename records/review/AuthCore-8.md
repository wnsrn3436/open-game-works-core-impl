# review AuthCore round 8

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R7-1 | fixed | `client/godot/plugins/ogw-secure-storage/build.sh` now follows `open-game-works-core/skills/client-core/engines/godot.md:57`: the header (build.sh:2-8) says all platforms are built on a Mac host and lists MinGW-w64 (`x86_64-w64-mingw32-g++`) and Docker with `debian:bullseye`; build.sh:23-26 stops on a host other than Darwin; after android, macos and ios (build.sh:58-104) it builds windows x86_64 with `scons platform=windows arch=x86_64 use_mingw=yes` (build.sh:106-111) and linux for `x86_64` and `arm64` in `docker run --platform linux/amd64` / `linux/arm64` with `LINUX_IMAGE="debian:bullseye"` (build.sh:15, 113-126). The two architectures are those `ogw-secure-storage.gdextension` names (`linux.x86_64`, `linux.arm64`). The Linux-host and `MINGW64_NT*` branches are removed, and no other file outside `records/` and `dist/` refers to them (grep for `Linux host`, `Windows host`, `MINGW64`, `MSYS2`). `sh -n build.sh` passes. The apt sources the containers use exist: `http://archive.debian.org/debian/dists/bullseye/Release` and `http://archive.debian.org/debian-security/dists/bullseye-security/Release` both return HTTP 200. The MinGW-w64 on this host is `mingw-w64 14.0.0_3`, matching the winpthreads 14.0.0 entry of `licenses.json`. R7-1 is a `spec` finding, so no restoration was needed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- `build.sh` was not run in this round; that it runs to the end and reproduces the committed windows and linux dists rests on `records/1793104699619-review-fix-mvqo8p2b3a97fc.md` `## review` (linux libraries byte-identical, windows DLL differing only in PE timestamps and checksum)
- The script was not checked on an Intel Mac, where the arm64 container runs emulated
- The range changes only `build.sh` and records; no AuthCore GDScript or plugin source changed, so no core test was run (core tests run through `ogw core test`, and they do not run plugin build scripts)
- The AuthCore debt list holds D6 (`backend_windows.cpp:59`), which is not in this input, so it was not judged here
