# review UnitTestCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/auth_core/tests/test_login.gd:311: medium `test_get_public_code_is_of_the_login_of_the_ban_session_and_empty_without_either` (added in this range) ends with `assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)`. The UnitTestCore spec `### log` says the error log count is asserted with `check_logs` only when the expected value is not 0. The assert checks nothing, because an unchecked error log left in the test already fails it

## debt

none

## must fix

none

## unknown

- The range `2ef5ae8d..94213018` changes no file under `client/godot/core/unit_test_core/`. I checked how the changes reach UnitTestCore through its dependencies and its inputs:
  - `BootstrapCore`: only the `public_code` format arguments of `_login_failed` and `_on_deletion_pressed` changed. UnitTestCore uses only `start_boot`, `BootstrapCoreDev.shutdown` and `BootTestReplacements`, and none of these changed
  - `generated/core_settings_types.json`: the new keys add no new type string. The first key of each of the 12 type strings is the same before and after the range, so `test_settings.gd::test_each_type_of_the_type_file_takes_its_values` uses the same keys
  - `generated/contract/core_contract.gd`: only `FindUserByPublicCode*` and `public_code` fields were added. `ResponseEnvelope`, which `make_response` encodes, did not change
  - `SoundCore` and `TweenCore`, which `test_input.gd` inits: the new settings keys have defaults in `generated/core_settings.json`. The arranged-element change of `TweenCore` applies only to a `Control` whose parent is a `Container`, and the buttons of `test_input.gd` are not in a `Container`
- I did not run the UnitTestCore core tests on the range end commit (native or browser run). I judged that the range does not break them by reading the code only
- The UnitTestCore code that existed before the range and that the range does not reach was not reviewed again
