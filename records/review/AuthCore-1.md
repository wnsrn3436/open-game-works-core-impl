# review AuthCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/auth_core/tests/test_terms.gd:88 | `test_get_terms_failure_fails_without_popup` ends with `assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)`. unit-test-core.md:116 allows a `check_logs` assert only when the expected value is not 0. `check_logs` counts only unchecked logs and marks them checked (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1266-1271`), and an unchecked error log left at the end already fails the test (unit-test-core.md:114). So the assert catches nothing that the test would not catch without it | Remove the assert | no | 95 |
| R1-2 | test evidence | medium | client/godot/core/auth_core/tests/test_account.gd:188 | `assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)` runs between the two `list_linked_providers` calls, and unit-test-core.md:116 does not allow it. Without this assert, an error log from the first call (`:180`) would stay unchecked, so the `check_logs(..., 1)` at `:192` would count 2 and fail (`unit_test_core.gd:1266-1271` counts every unchecked log). The assert therefore checks nothing that `:192` does not | Remove the assert | no | 92 |
| R1-3 | test evidence | medium | client/godot/core/auth_core/tests/test_login.gd:470 | `test_pending_token_is_written_on_foreground` ends with `assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)`, which unit-test-core.md:116 does not allow. Any error log after the check at `:461` would stay unchecked, and the unchecked-error-log rule (unit-test-core.md:114) would already fail the test | Remove the assert | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | open | R1-1 | The assert is still at client/godot/core/auth_core/tests/test_terms.gd:88 |
| D3 | open | R1-2 | The assert is still at client/godot/core/auth_core/tests/test_account.gd:188 |
| D4 | open | R1-3 | This is the same assert as D5. client/godot/core/auth_core/tests/test_login.gd:471 is now an empty line, and the assert is at :470 |
| D5 | open | R1-3 | The assert is still at client/godot/core/auth_core/tests/test_login.gd:470 |

## must fix

none

## unknown

- The commit range 13d14bb..13d14bb is empty, so no change exists for this review to cause or reveal a finding. Only the positions of the input `## debt` items were read: `test_terms.gd:83-88`, `test_account.gd:168-196`, `test_login.gd:450-470`, and the `check_logs` implementation they rely on (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1260-1271`). The other AuthCore code and tests were not reviewed against the AuthCore spec in this round, so `## out of scope` being `none` does not mean they are free of problems
- A search of the AuthCore tests found no other `check_logs` assert expecting 0. `test_consent.gd:176`, `:192` and `:271` call `check_logs("error", "NetworkCore")` without asserting the count. Whether that is allowed was not judged, because unit-test-core.md does not address it
- The AuthCore tests were not run. They run through `ogw core test`, which a review agent does not start
