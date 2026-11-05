# review UnitTestCore round 5

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R5-1 | test evidence | medium | client/godot/core/unit_test_core/dev/unit_test_core.gd:941 | The `## error` row "a test host request fails" (`open-game-works-core/skills/client-core/modules/unit-test-core.md:177`: failure value and an error log) has no test for three of its branches: `PUT /result` in `_send_result_through` (`unit_test_core.gd:940-942`, `false` and `_host_failure`), `PUT /released` in `_send_released` (`:985-987`) and the `DELETE` of a WebSocket relay at test end in `_delete_relay` (`:1047-1048`, called from `_finish_test` through `:695`). No test under `client/godot/core/unit_test_core/tests` reaches them: `test_host_failures.gd:7` covers only `POST /servers`, `PUT /responses`, `GET /requests`, `POST /ws-servers` and `POST /input`; `test_run.gd:455` calls `_send_released` only with a host that answers 204; `run_root` (`tests/support/unit_test_core_test_case.gd:136-137`) registers 204 for `/result` and `/released`; the test-end delete failure is tested only for a server (`test_run.gd:106`, `tests/resources/sample_server_delete.gd:11`), not a relay (`test_ws_relay.gd:161` deletes relays the host has). These branches are unchanged since `716f069`, where removing the three `_host_failure` calls and running `ogw core test godot UnitTestCore` gave `UnitTestCore pass` (input D4); commit `8de72a8`, the only later change to the target, does not touch them | Add tests in which the test host answers `/result` and `/released` with a non-204 status (e.g. a loopback HTTP server as in `test_host_failures.gd`) and check `false` and one `UnitTestCore` error log, and a test that leaves a relay URL the test host does not have in the test's relays (as `sample_server_delete.gd` does for servers) and checks the `DELETE /ws-servers/<n> failed` error log | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D4 | open | R5-1 | The three failure branches named by D4 (now `unit_test_core.gd:941`, `:987`, `:1048`) are unchanged and still have no test that reaches them; see R5-1 |

## must fix

none

## unknown

- The commit range is empty (`5434503..5434503`), so the only findings are input D4; round 4 had no findings and no `open` rows in `## previous`, so `## previous` has no rows to decide
- The restoration of D4 (removing the three `_host_failure` calls and running the module tests) was not run again this round. R5-1 rests on the code reading above (no test reaches the branches) and on `git log 716f069..HEAD` showing that the only later change to the target (`8de72a8`) does not touch `_send_result_through`, `_send_released`, `_delete_relay` or their tests
- The browser run (`--web`) was not run
