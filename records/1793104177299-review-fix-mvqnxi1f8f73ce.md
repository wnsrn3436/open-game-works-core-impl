# review fix AuthCore round 5

## done

- I changed no module, tool or per-engine rules document. The only open finding is R2-1. An agent cannot fix it on this host. The cause is in `## review`, and it is the same cause as in rounds 2, 3 and 4
- `## findings` of the round 5 review file is `none`. The code check result of the input has no `fail`: type check, lint, dependency and secret are `pass`. `fix test proof` is `unknown` because no test file of AuthCore changed. So there was nothing else to fix

## spec proposals

- Same as the first item of the round 1–4 fix reports, still not applied. godot.md:57 says windows is built on a Windows host and linux on a Linux host. Two ways out, and a human must choose one:
  - (a) Change godot.md:57 to allow two builds on a Mac host: a MinGW-w64 cross build for the windows DLL, and the `Linux)` branch of `client/godot/plugins/ogw-secure-storage/build.sh` run in a named Linux container image (`debian:bullseye`, which sets the lowest glibc) for the linux libraries. The committed dists were already built that way, so R2-1 closes once the spec is changed
  - (b) Keep the rule. A human runs `client/godot/plugins/ogw-secure-storage/build.sh <work folder>` in three places: the MSYS2 MINGW64 shell of a Windows x86_64 host, a Linux x86_64 host and a Linux arm64 host. The human then commits the changed `dist/windows/` and `dist/linux/`
- Harness gap (same as round 4). No harness setting or command input names a Windows or Linux build host for a core agent. Without that, the review/fix chain of a `spec change: no` finding that only another host can close never converges: the tool sends the finding back each round, and the core agent writes the same report. A way for the chain to stop, or to hand the finding to a human, would end such loops

## review

- R2-1: not fixed and not disputed. godot.md:57 names the hosts, and the input line `- open finding: R2-1 ... spec change: no` keeps the spec as it is
  - I checked the environment again in this round, and nothing changed since round 4. `uname -a` gives Darwin 27.0.0 arm64 (`Jungu-MacBookPro.local`). `tart`, `prlctl`, `utmctl`, `VBoxManage`, `multipass`, `limactl`, `colima`, `orb` and `qemu-system-x86_64` are not installed. `~/.ssh/known_hosts` holds only `github.com`, and there is no `~/.ssh/config`. Harness settings `hosts` holds only this Mac. godot.md:57 is unchanged (the last harness commit to `skills/client-core/engines/godot.md` is c08257e, and that line is the same)
  - So the committed `dist/windows/.../libogw-secure-storage.windows.x86_64.dll` (MinGW cross build) and `dist/linux/.../libogw-secure-storage.linux.{x86_64,arm64}.so` (`debian:bullseye` containers) cannot be rebuilt on the named hosts. Rebuilding again in containers or with MinGW would not meet godot.md:57. Removing the dists would drop windows and linux, which the `ogw-secure-storage` row of godot.md:41 lists as target platforms
  - `build.sh` already builds each platform only on its own host (round 2, 9b5616b). So no code change is left to make; closing R2-1 needs proposal (a) or (b)

## unverified

- `build.sh` has not been run on a real Linux host or in an MSYS2 MINGW64 shell. I only read its `Linux)` and `MINGW64_NT*)` branches
- I ran no core test and no `ogw code check core` in this round, because no file outside `records/` changed. The latest results are the round 5 code check of the input (no `fail`) and the core tests of the round 2 fix report
