# review: UnitTestCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/unit_test_core/dev/unit_test_core.gd:1540: medium `require_platform` does not end the test, although `open-game-works-core/skills/client-core/modules/unit-test-core.md:228` says that it "ends that test as skip". It only sets `skip_reason` and returns, so the test function goes on. Run path: a core test calls `require_platform(["no_such_platform"])` and then awaits a signal that never fires. `_on_test_not_returned` then calls `_end_run_early`, which adds a run failure and gives exit code 1, instead of one skip and the next test. The test callers avoid this only with their own guard after the call (e.g. `client/godot/core/unit_test_core/tests/test_page_input.gd:45`, `client/godot/core/auth_core/tests/test_plugin_waits.gd:121`), and no defining document names that guard. `client/godot/core/unit_test_core/tests/resources/sample_platform.gd:7` has only `assert_true(true)` after the call, so no test checks that the rest of the body does not run. This existed before the range.
- client/godot/core/unit_test_core/dev/unit_test_core.gd:130: medium `init` does not read `UnitTestCore.startTimeLimitMs`. `open-game-works-core/skills/client-core/engines/godot.md:116` says that in `init` a module reads the keys of `## settings` of its spec, and that a missing key or a key of another type gives an error log and a failed `init`. `open-game-works-core/skills/client-core/modules/unit-test-core.md:191` lists this key, but `_init_failure` checks only `UnitTestCore.testTimeLimitMs` and `UnitTestCore.runTimeLimitMs`. Under `client/godot/core` the key appears only in a comment at `client/godot/core/unit_test_core/dev/unit_test_core.gd:946`. Run path: with the key removed from `core_settings.json`, `init` returns `true`. Only the harness tool reads this key. This was found by reading and not run, and it existed before the range.
- client/godot/core/unit_test_core/dev/unit_test_core.gd:1484: medium The `## error` rows `put_page_key` with an empty key (`open-game-works-core/skills/client-core/modules/unit-test-core.md:178`) and a failed test host request (`open-game-works-core/skills/client-core/modules/unit-test-core.md:176`) are not fully tested. `put_page_key` is called only with `"q"` in the tests under `client/godot/core` (`client/godot/core/unit_test_core/tests/test_page_input.gd:54`, `client/godot/core/unit_test_core/tests/test_page_input.gd:66`). The failure branches of `POST /input` with a status other than 204 and 404 (line 1091), `POST /servers` (line 1404), `PUT /responses` (line 1425), `GET /requests` (line 1441) and `POST /ws-servers` (line 1461) log an error under the tag `UnitTestCore`, but no test checks that log. Only `PUT /started` has such a test (`client/godot/core/unit_test_core/tests/test_run.gd:511`). This was found by `grep` and reading, no mutation was run, and it existed before the range.

## debt

none

## must fix

none

## unknown

- Scope: the commit range changes no file under `client/godot/core/unit_test_core/`, `core-spec/` or `settings/`. Outside `records/` it changes only `client/godot/core/localization_core/localization_core.gd` (`_restore_heading_types`) and `client/godot/core/localization_core/tests/test_font_weight.gd`. `## spec changes` is `none`.
- Reach into this target, checked by reading: the test setup calls `BootstrapCoreDev.shutdown` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:639`), which reaches `LocalizationCore.release`, and `_restore_heading_types` runs from `_clean_up` only when `_heading_chain` is not null, so only after `load_fonts` applied fonts. A heading type now stays in the default theme as an empty record after `release`, and UnitTestCore does not reset the theme in test setup, so that record stays for the next tests of the run. The next `_apply_fonts` saves an empty base and no own font for such a type (`client/godot/core/localization_core/localization_core.gd:619`), and `_restore_heading_types` then gives the same result as for a type the theme did not have. This finds no order dependence between tests (`open-game-works-core/skills/client-core/modules/unit-test-core.md:41`). This was read and not run as a separate mutation or a run in another test order.
- The tests of UnitTestCore do not run the changed path: `client/godot/core/unit_test_core/tests/test_input.gd:20` runs `LocalizationCore.init` and `load_translation` without `load_fonts`, and no file under `client/godot/core/unit_test_core/tests/` names `load_fonts` or a heading type.
- The new test of the range calls only `UnitTestCore.set_test_settings` and `LocalizationCore` operations. Its cleanup of the default theme (`theme.remove_type`) has no early return before it. A test that does not return is the case that skips this cleanup, and that case ends the run.
- Run in this review: `ogw core test godot UnitTestCore` and `ogw core test godot UnitTestCore --web` pass on the target commit. The output of both jobs holds the lines `UnitTestCore pass` and `UnitTestCore pass (reused)`, so these results may have been reused from a passing result of the same key instead of running again.
- `client/godot/core/unit_test_core/dev/` was read in full, but its comparison with the spec was a reading pass and not a review of the whole target, because the range does not change it. The bodies of `client/godot/core/unit_test_core/tests/` were read only where the items above name them; the other tests were checked by name against `## test`. The three `## out of scope` items are not an exhaustive list of problems that existed before the range.
- Not read: the test host, the WebSocket relay and the input injection of the harness tool (`open-game-works-core/tools/src/commands/core/lib/`), which carry out the test host table of the spec. The specs of the modules UnitTestCore depends on were not compared with the code, except `get_anchor_rect` of `UICore` and `count_subscriptions` of `EventCore`.
