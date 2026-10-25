# review AuthCore round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | test evidence | medium | client/godot/core/auth_core/tests/test_login.gd:311 | Input item D1 remains. `test_get_public_code_is_of_the_login_of_the_ban_session_and_empty_without_either` still ends with `assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)`. UnitTestCore spec `### log` (unit-test-core.md:116) says the error log count is asserted with `check_logs` only when the expected value is not 0. `check_logs` (client/godot/core/unit_test_core/dev/unit_test_core.gd:1260-1271) only counts and marks unchecked logs, and unit-test-core.md:114 already fails a test with an unchecked error log left, so removing this assert does not change whether the test fails for any code change: an extra AuthCore error log after the `:292` check fails the test either way | Remove the `check_logs(..., 0)` assert at `:311` | no | 95 |

## previous

none

## out of scope

- client/godot/core/auth_core/tests/test_terms.gd:88: medium `test_get_terms_failure_fails_without_popup` asserts `check_logs("error", "AuthCore")` equals 0, which unit-test-core.md:116 forbids; the unchecked-error-log rule (unit-test-core.md:114) already fails the test, so the assert checks nothing
- client/godot/core/auth_core/tests/test_account.gd:188: medium asserts `check_logs("error", "AuthCore")` equals 0 between the two `list_linked_providers` calls, which unit-test-core.md:116 forbids; an error log from the first call would also make the `check_logs(..., 1)` assert at `:192` count 2 and fail, so the assert checks nothing
- client/godot/core/auth_core/tests/test_login.gd:471: medium asserts `check_logs("error", "AuthCore")` equals 0 at the end of the test, which unit-test-core.md:116 forbids; the unchecked-error-log rule (unit-test-core.md:114) already fails the test, so the assert checks nothing

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R2-1 | client/godot/core/auth_core/tests/test_login.gd:311 still has `assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)`; the commit range d798f17..d798f17 is empty, so nothing changed it |

## must fix

none

## unknown

- The commit range d798f17..d798f17 is empty and there are no core agent reports or spec changes, so no AuthCore code was reviewed for new changes. Only the D1 position, the `check_logs` uses in `client/godot/core/auth_core/tests/` and `UnitTestCore.check_logs` (client/godot/core/unit_test_core/dev/unit_test_core.gd:1260) were read
- Round 1 had no findings, so `## previous` has no rows
- The AuthCore tests were not run. They run through `ogw core test` with its test host, and a review agent does not start that. The decisions above come from reading the code and unit-test-core.md
