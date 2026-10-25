# UnitTestCore review round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/qa_core/tests/test_state.gd:245: medium The new test `test_a_step_whose_budget_ran_out_in_the_frame_of_a_pause_succeeds` waits for the `step` command to add its budget with `for i: int in 5: if TimeCoreDev.get_step_budget() > 0: break; await UnitTestCore.wait_frames(1)`, a polling loop with a frame count limit. `## async wait` of the UnitTestCore spec says a condition without an event is checked every frame without a frame count limit, and `wait_frames` is only for targets whose progress engine frames decide. The automated check that the spec says blocks this (`tools/src/commands/check/static/frame-polling.ts` in the harness) only scans `client/tests/` (`isClientTest`), so it does not reach core tests and does not block this loop

## debt

none

## must fix

none

## unknown

- The commit range 47b588d..8db97a6 changes no file under `client/godot/core/unit_test_core/`. It changes BootstrapCore (fatal screen font) and its tests, QACore (`step` fails when game time is paused) and its tests, RequirementCore (owner watch slots) and its tests, plus records. So I checked only the UnitTestCore code that the changed tests call: `set_test_settings` with `LocalizationCore.bodyFontWeight` (typed `integer` in `client/godot/generated/core_settings_types.json:80`, so `400` passes the type check), `check_logs` with levels `warn` and `error`, `check_script_errors`, `latch_event` and `wait_latch` for a latch made before the test boot, `wait_frames`, `advance_clock(100, false)` with `TimeCore` initialized, and `start_test_boot` through `client/godot/core/bootstrap_core/tests/support/boot_test_support.gd:256` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1213-1360`, `1516-1680`). I found no problem in these paths
- The rest of UnitTestCore (test setup, fake network, test host, loopback HTTP server, WebSocket relay, page input, fake realtime transport, run and result file, time limits, fixtures) was not reviewed, because no change in the range touches it or calls it in a new way
- I did not check whether the BootstrapCore, QACore and RequirementCore changes match their own specs, because those modules are outside this target
- Tests were not run. I judged by reading the code only
