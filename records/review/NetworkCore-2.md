# review NetworkCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit 60170092 adds `test_release_before_the_first_init_deletes_the_set_transport` and `test_release_after_release_deletes_the_set_transport_without_a_log` in `client/godot/core/network_core/tests/test_lifecycle.gd:78-105`. Each calls `NetworkCoreDev.set_transport(t)` while NetworkCore is not initialized, calls `NetworkCore.release()`, asserts `NetworkCore._transport == null`, and then asserts that the following `init` uses the engine transport (`_active_transport` is not `t`, and is `_HTTP_TRANSPORT`, or `_WEB_TRANSPORT` on Web). The defect was restored in a temporary worktree (`git worktree add --detach` of HEAD df4b6ae4) by replacing `_transport = null` at `client/godot/core/network_core/network_core.gd:147` with `pass`. `ogw core test godot NetworkCore --file client/godot/core/network_core/tests/test_lifecycle.gd` then failed both tests (`expected to equal [<null>]`, `expected to not equal` the set transport, `the engine HTTP transport`). With the line restored, the same command passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Within the commit range, the only change to NetworkCore is the test file `client/godot/core/network_core/tests/test_lifecycle.gd` (commit 60170092). NetworkCore code is not changed in the range, and the rest of the module was not reviewed again
- The restored-defect run and the passing run were made only for `godot` headless, not for `godot --web`. The `_WEB_TRANSPORT` branch of `_assert_engine_transport` was not run
- The "no log" asserts of the new tests count only NetworkCore `warn` and `error` logs (`UnitTestCore.check_logs` accepts only those levels), so they do not detect an info log from `release`. No defining document line was found that a NetworkCore info log on this path would break, so this was not written as a finding
- The other modules changed in the range (AdCore, AuthCore, BootstrapCore, NativeUiCore, NoticeCore, PaymentCore, PushCore, RealtimeCore) are outside this target and were not reviewed
