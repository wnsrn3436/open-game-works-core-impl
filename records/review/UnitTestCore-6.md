# review UnitTestCore round 6

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R5-1 | fixed | The range adds `client/godot/core/unit_test_core/tests/test_host_failures.gd:41` (`PUT /result` through `_send_result_through` and `PUT /released` through `_send_released` to a loopback HTTP server that answers 404; checks `false`, one `UnitTestCore` error log each, and that both requests reached that server) and `client/godot/core/unit_test_core/tests/test_run.gd:117` with `tests/resources/sample_relay_delete.gd` (a test leaves the relay URL `<test host>/ws-servers/999999` the test host does not have; checks one run failure `unchecked error logs after ...` with `DELETE /ws-servers/999999 failed`). Restoration: in a temporary worktree of `ee7af4d` at `worktrees/_core/review-restore-mw33l2v53604f1` (outside the target checkout, removed afterwards), the three `_host_failure` calls at `client/godot/core/unit_test_core/dev/unit_test_core.gd:941`, `:987`, `:1048` were replaced by `pass`. `ogw core test godot UnitTestCore --file .../tests/test_host_failures.gd` gave `UnitTestCore fail` (`test_result_and_release_signal_a_test_host_refuses_give_false_and_one_error_log: [0] expected to equal [1]: PUT /result error log; [0] expected to equal [1]: PUT /released error log`) and `--file .../tests/test_run.gd` gave `UnitTestCore fail` (`test_next_test_starts_after_the_deletes_of_the_relays_of_the_test_before: [0] expected to equal [1]: the delete the test host refused`). With the code restored, both files gave `UnitTestCore pass` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D4 | fixed | none | The three failure branches D4 names (`unit_test_core.gd:941`, `:987`, `:1048`) are now reached by tests that fail when the error log is removed; see `## previous` R5-1 |

## must fix

none

## unknown

- The restoration runs were native only with `--file`; the browser run (`--web`) was not run this round, neither with the restored defect nor on the unchanged code (the core agent report says the unchanged browser run passes)
- The whole `UnitTestCore` module was not run this round; only the two changed test files were run, on the restored and on the unchanged code
- Changes in the range outside the target (`server/core/coupon/`, `records/`) were not reviewed
