# review AuthCore round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | open | The range 82990c1..f81010f changes only records (`git diff --stat`: `records/1793103936188-review-fix-mvqnsbzw759f27.md`, its `-runs.json`, `records/review-debt/AuthCore.json`, `records/review/AuthCore-3.md`); no file under `client/godot/plugins/ogw-secure-storage/` changed. The last commit that changed `dist/windows/` or `dist/linux/` is 9b5616b. `dist/windows/addons/ogw-secure-storage/windows/libogw-secure-storage.windows.x86_64.dll` contains the strings `Mingw-w64 runtime failure:` and the gcc bug-report URL of a MinGW-w64 GCC build, and the fix report `records/1793103936188-review-fix-mvqnsbzw759f27.md` `## review` R2-1 states it is the MinGW cross build on the Mac host. `dist/linux/addons/ogw-secure-storage/linux/libogw-secure-storage.linux.x86_64.so` contains `GCC: (Debian 10.2.1-6) 10.2.1 20210110` (the `debian:bullseye` toolchain), which the same report states was built in a container on the Mac host. `open-game-works-core/skills/client-core/engines/godot.md:57` says windows is built on a Windows host and linux on a Linux host, and input `## spec changes` is `none`, so the report's spec proposal is not applied. The report does not dispute the finding |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range has no code or test change, so no AuthCore code was read again beyond the committed plugin dists of R2-1; the fix report and the review list commit were read
- That the windows DLL and the linux libraries were built on a Mac host (and not on a Windows or Linux host) rests on the fix report and on the toolchain strings in the binaries; a toolchain string alone does not show the build host
- No core test was run: no code changed in the range, and the core tests run through `ogw core test`
- The AuthCore debt list holds D6 (`backend_windows.cpp:59`), which is not in this input, so it was not judged here
