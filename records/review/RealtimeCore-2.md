# review RealtimeCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit 5261448b adds `test_release_without_init_deletes_the_transport_without_a_log` (`client/godot/core/realtime_core/tests/test_lifecycle.gd:58`). It calls `set_transport` with no `init`, then `release`, then asserts `_transport` is null with no error or warn log, then `init` with no `set_transport` and `join_match` returns `FAILED` with one error log and no transport call. Restored the defect in a `git worktree add --detach` copy of HEAD b54abe0c by changing `_transport = null` in the non-init branch of `release` (`client/godot/core/realtime_core/realtime_core.gd:179`) to `pass`, then ran `ogw core test godot RealtimeCore --file client/godot/core/realtime_core/tests/test_lifecycle.gd` there. Result `RealtimeCore fail`: only `test_release_without_init_deletes_the_transport_without_a_log` failed (`Expected [... realtime_recording_transport.gd] to be NULL`, `[0] expected to equal [1]`, `[2] expected to equal [0]`, `test time limit 30000 ms passed`). The worktree was then removed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Of the commit range, only `client/godot/core/realtime_core/tests/test_lifecycle.gd` (commit 5261448b, test only) changes RealtimeCore. The other changed files belong to other modules and to review records, so they were not reviewed here
- RealtimeCore code and tests that this range does not change were not reviewed again
- Only `test_lifecycle.gd` was run, and only on the copy with the defect restored. The unchanged checkout was not run here. The core agent report says `ogw core test godot` passed on 5261448b, native and `--web`, for RealtimeCore and its dependents
