# review RealtimeCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/realtime_core/realtime_core.gd:179 | Commit ad967246 adds `_transport = null` to `release` of a RealtimeCore that is not initialized, as `## lifecycle` of `core` requires (a `release` of a module that is not `init`ed deletes the values its pre-`init` operations set; `set_transport` is the pre-`init` operation of RealtimeCore, `### API` of `realtime-core`). No test checks this. The only assert on `RealtimeCore._transport` is `_assert_initial_state` in `client/godot/core/realtime_core/tests/test_lifecycle.gd:143`, and it runs only after `init` and `release` or the tree teardown, where `_teardown` (`realtime_core.gd:1323`) clears the transport. `test_boot_shutdown_pre_init.gd` covers only `DataCore` and `ResourceCore`. Path with no failing test when the line is deleted: `start_realtime(true, false)` (`test_operations_outside_init_log_errors_and_return_failure_values`) calls `set_transport` with no `init`; `shutdown` then calls the non-init `release`; nothing reads `_transport` afterwards before the next test calls `set_transport` again or `init` + `release` clears it. | Add a core test: `set_transport(t)` with no `init`, `RealtimeCore.release()`, then `_transport` is `null` with no log; then `init` with no `set_transport` makes `join_match` fail with the no-transport error log. The test fails when the `_transport = null` line of the non-init `release` is removed | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Of the commit range, only `client/godot/core/realtime_core/realtime_core.gd` (2 lines in ad967246) is RealtimeCore code; the other changed files are other modules (server core, AuthCore, BootstrapCore, DataCore, NetworkCore and others) and were read only to see how `BootstrapCore` `shutdown` now calls `RealtimeCore.release` before `init` (`client/godot/core/bootstrap_core/bootstrap_core.gd:1343`). They are not reviewed here
- The rest of RealtimeCore, which this range does not change, was not reviewed
- Core tests were not run. The missing test of R1-1 was found by searching the tests for reads of `RealtimeCore._transport` and calls of `RealtimeCore.release`, not by running a copy with the line removed
