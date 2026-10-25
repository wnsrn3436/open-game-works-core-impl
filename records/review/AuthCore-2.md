# review AuthCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | 1a946ad removed `assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)` from the end of `test_get_terms_failure_fails_without_popup` (client/godot/core/auth_core/tests/test_terms.gd:83-87). The test extends `UnitTestCase`, and `_finish_test` (client/godot/core/unit_test_core/dev/unit_test_core.gd:648-658) still fails it for any unchecked error log, so the check that the assert claimed is kept. This finding was about an assert that checked nothing, not a missing test, so no defect-restore test applies |
| R1-2 | fixed | 1a946ad removed the 0 assert between the two `list_linked_providers` calls (client/godot/core/auth_core/tests/test_account.gd:168-195). An error log from the first call now stays unchecked and makes the `check_logs("error", "AuthCore")` assert expecting 1 at `:191` count 2 and fail (`unit_test_core.gd:1260` counts every unchecked log of that level and tag), so nothing is lost |
| R1-3 | fixed | 1a946ad removed the 0 assert from the end of `test_pending_token_is_written_on_foreground` (client/godot/core/auth_core/tests/test_login.gd:448-468). Error logs after the `check_logs(..., 1)` at `:460` stay unchecked, and `_finish_test` fails the test for them |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | fixed | none | The assert is gone from client/godot/core/auth_core/tests/test_terms.gd (removed in 1a946ad). A search of the AuthCore tests finds no `check_logs` assert expecting 0 |
| D3 | fixed | none | The assert is gone from client/godot/core/auth_core/tests/test_account.gd (removed in 1a946ad) |
| D4 | fixed | none | Same assert as D5. It is gone from client/godot/core/auth_core/tests/test_login.gd (removed in 1a946ad) |
| D5 | fixed | none | The assert is gone from client/godot/core/auth_core/tests/test_login.gd (removed in 1a946ad) |

## must fix

none

## unknown

- Within the commit range, AuthCore changed only through the three removed test lines in 1a946ad. The other files in the range (QACore settings, generated settings, core-spec JSON of QACore, ScreenEffectCore, TweenCore and UICore, records) are not AuthCore code. I did not review them, and I did not review AuthCore code outside the changed tests against the AuthCore spec
- I did not run the AuthCore tests. They run through `ogw core test`, which a review agent does not start. The fix report says native 871/871 and web 865/865 passed, and I did not check that claim
