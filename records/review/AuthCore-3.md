# review AuthCore round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | caef783 removes `assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)` from the end of `test_get_public_code_is_of_the_login_of_the_ban_session_and_empty_without_either` (client/godot/core/auth_core/tests/test_login.gd:289-310). The test still asserts the boot error log with `check_logs(..., 1)` at :292, the ban result, `get_public_code` after the ban and after the success login; an extra AuthCore error log after :292 still fails the test through the unchecked-error-log rule (unit-test-core.md:114). The fix removes an assert and adds no test, so no defect restore applies |

## out of scope

- client/godot/core/auth_core/tests/test_terms.gd:88: medium `test_get_terms_failure_fails_without_popup` asserts `check_logs("error", "AuthCore")` equals 0, which unit-test-core.md:116 forbids; the unchecked-error-log rule (unit-test-core.md:114) already fails the test, so the assert checks nothing (already in the AuthCore debt list as D2, not in this input)
- client/godot/core/auth_core/tests/test_account.gd:188: medium asserts `check_logs("error", "AuthCore")` equals 0 between the two `list_linked_providers` calls, which unit-test-core.md:116 forbids; an error log from the first call would also make the `check_logs(..., 1)` assert at `:192` count 2 and fail, so the assert checks nothing (already in the AuthCore debt list as D3, not in this input)
- client/godot/core/auth_core/tests/test_login.gd:470: medium asserts `check_logs("error", "AuthCore")` equals 0 at the end of the test, which unit-test-core.md:116 forbids; the unchecked-error-log rule (unit-test-core.md:114) already fails the test, so the assert checks nothing (already in the AuthCore debt list as D4 at :471, the line moved up by one after caef783)

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | client/godot/core/auth_core/tests/test_login.gd no longer has the `check_logs("error", "AuthCore"), 0` assert in `test_get_public_code_is_of_the_login_of_the_ban_session_and_empty_without_either` (removed by caef783); the remaining `check_logs(..., 0)` asserts in auth_core/tests are at test_terms.gd:88, test_account.gd:188 and test_login.gd:470, all outside this test |

## must fix

none

## unknown

- The commit range d798f17..fd312ef changes only client/godot/core/auth_core/tests/test_login.gd (one line removed) and records files; no AuthCore runtime code changed, so only that test, the `check_logs` uses in client/godot/core/auth_core/tests/ and unit-test-core.md `### log` were read
- The AuthCore tests were not run. They run through `ogw core test` with its test host, and a review agent does not start that. The core agent report states `ogw core test` passed on `godot --web` and natively except QACore (skipped, render pass did not run)
