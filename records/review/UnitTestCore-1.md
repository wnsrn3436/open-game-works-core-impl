# review UnitTestCore round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range 9b1e14b5..eb1605f1 changes no file under client/godot/core/unit_test_core/, and core-spec/UnitTestCore.json is unchanged. The last commit that changes that folder is f0fac74, an ancestor of the range start. Among the dependency modules (UtilCore, LogCore, EventCore, TimeCore, NetworkCore, InputCore, UICore, RealtimeCore, BootstrapCore), the range changes only two BootstrapCore test files: client/godot/core/bootstrap_core/tests/test_boot_dev_run.gd and client/godot/core/bootstrap_core/tests/test_boot_fatal.gd. No BootstrapCore code changes
- The other client changes of the range were read: localization_core (`list_languages` parameter type), message_core (`show_black_box` signature), payment_core (a comment), qa_core (settings reads removed) and their tests. A search under client/godot/core/unit_test_core/ finds no call to `list_languages` or `show_black_box` and no use of the settings keys the range moved or removed (`uiCheckScreens`, `uiQuality`, `gamepadSupported`, `supportedLanguages`, `AccessibilityCore.textScales`)
- The generated settings change reaches UnitTestCore through `_settings_types` (client/godot/core/unit_test_core/dev/unit_test_core.gd:94). The range removes `uiCheckScreens` and `uiQuality` from client/godot/generated/core_settings_types.json and adds `coupon.maxCodePicks` and `matchmaker.roomCodeMaxPicks`. A search of client/, settings/, core-spec/, test-data/ and tools/data-tool/src/ for `uiCheckScreens` and `uiQuality` finds nothing. The type file still has 12 distinct type strings, so `assert_true(keys.size() >= 12)` at client/godot/core/unit_test_core/tests/test_settings.gd:45 still holds, but with no margin. `array<object>` and `object` still have keys, and the key constants of client/godot/core/unit_test_core/tests/test_settings.gd were not compared one by one beyond `QualityCore.deviceClasses` and `AccessibilityCore.colorMatrices`
- The new test client/godot/core/qa_core/tests/test_lifecycle.gd:47 calls `set_invalid_test_settings` with `AccessibilityCore.textScales`, `gamepadSupported` and `supportedLanguages`. All three are still keys of the type file (client/godot/generated/core_settings_types.json:2, :77, :184), so the call returns `true`, which agrees with `## error` of the spec. That test belongs to QACore and was not run in this review
- tools/data-tool/src/godotgen.ts changes the list type of `array<vector<float>>` to `Packed*Array`. Test setup calls `GameDataDev.clear_settings` (client/godot/core/unit_test_core/dev/unit_test_core.gd:641), which calls the generated `GameSetting._clear_tests` (tools/data-tool/src/godotgen.ts:361, :388). How the `clear` lines of that function are built for the new type was not read. tools/tests/godot/test_data_round_trip.gd sets `tool_test_points` as a test value and calls `clear_settings`, but does not assert the value of `tool_test_points` after the clear. That is a question for the data tool review, and it was not run here
- `ogw core test godot UnitTestCore` and `ogw core test godot UnitTestCore --web` both reported `UnitTestCore pass`. The output does not say whether the module ran again or a kept passing result was used. Tests of the modules that depend on UnitTestCore were not run
- The current spec was compared with the code by reading unit_test_core.gd and the files under client/godot/core/unit_test_core/dev/. All operations of `## DEV` exist under those names, and the rewritten wording of the spec (harness commit 4ed7913) names nothing the code lacks. Input `## spec changes` is `none`, so this was not a full audit: the `## test` items of the spec were compared with the test names only for the fake realtime transport, the fake network and `tap`, not one by one, and no mutation was run
- The test host, the WebSocket relay and the browser input of the spec are implemented in the harness tool, not in this target. Only the run config arguments of open-game-works-core/tools/src/commands/core/lib/godot.ts and open-game-works-core/tools/src/commands/check/lib/regression.ts were read: a regression run always passes `ogw_shared_fixture_dir` and a core run `ogw_core_fixture_dir`, so `_run_kind` gives the right kind
- records/review-debt/UnitTestCore.json holds D1 (`require_platform` does not end the test), D2 (`init` does not read `UnitTestCore.startTimeLimitMs`) and D3 (failure branches of test host requests and the empty key of `put_page_key` without a test). Input `## debt` is `none`, so these items were not judged and stay in the list. They were not reproduced in this round, and the line numbers in them were not rechecked
- Read and not written as a problem, because no defining document settles it and it was not run: `_record` (client/godot/core/unit_test_core/dev/unit_test_core.gd:464) gives `skip` when `skip_reason` is set, before it looks at the failures. An assert failure, an unchecked error log or a time limit in the same test is therefore recorded as `skip`. The spec does not set which wins. The body after `require_platform` goes on running because of D1, so a later review of D1 should decide this together with it
