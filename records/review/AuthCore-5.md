# review AuthCore round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | open | The range f81010f..1881370 changes only records (`git diff --stat`: `records/1793104039505-review-fix-mvqnujpt124599.md`, its `-runs.json`, `records/review/AuthCore-4.md`, `records/review/AuthCore-4-runs.json`); `git diff --name-only f81010f..1881370 -- client server` is empty. The last commit that changed `client/godot/plugins/ogw-secure-storage/dist/windows/` or `dist/linux/` is still 9b5616b. `dist/windows/addons/ogw-secure-storage/windows/libogw-secure-storage.windows.x86_64.dll` still contains `Mingw-w64 runtime failure:` (MinGW cross build on the Mac host, per the round 3 and round 4 fix reports), and both `dist/linux/addons/ogw-secure-storage/linux/libogw-secure-storage.linux.{x86_64,arm64}.so` contain `GCC: (Debian 10.2.1-6) 10.2.1 20210110` (`debian:bullseye` containers on the Mac host, per the same reports). `open-game-works-core/skills/client-core/engines/godot.md:57` still says windows is built on a Windows host and linux on a Linux host, and input `## spec changes` is `none`. The fix report `records/1793104039505-review-fix-mvqnujpt124599.md` does not dispute the finding; it escalates it to a human with spec proposals (a) and (b), neither of which is applied |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range has no code or test change, so no AuthCore code was read again beyond the committed plugin dists of R2-1; the fix report and the round 4 review file were read
- That the windows DLL and the linux libraries were built on a Mac host (and not on a Windows or Linux host) rests on the fix reports and on the toolchain strings in the binaries; a toolchain string alone does not show the build host
- No core test was run: no code changed in the range, and the core tests run through `ogw core test`
- The AuthCore debt list holds D6 (`backend_windows.cpp:59`), which is not in this input, so it was not judged here
