# review: UnitTestCore round 1

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

- The commit range `d4c3ae7f..99916663` changes no file under `client/godot/core/unit_test_core/`, and no file of its dependencies `UtilCore`, `LogCore`, `EventCore`, `TimeCore`, `NetworkCore`, `InputCore`, `RealtimeCore`, `BootstrapCore`. It also does not change `client/godot/generated/core_settings_types.json`, `test-data/` or `fixtures/`
- The only dependency changed is `UICore`. In `client/godot/core/ui_core/ui_core.gd` the range only adds `is_dimmed`, `_is_dimmed` and `_dim_above`, plus two comment header edits. UnitTestCore calls only `UICore.get_anchor_rect` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1282`), which the range does not change. Whether `tap` and `tap_anchor` behave the same follows from that reading; I did not run them
- `client/godot/generated/core_settings.json` drops `maxFlatShare`. That key is not in `core_settings_types.json` and is not in `settings/`, and UnitTestCore reads the types file for `set_test_settings` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1589`), so its key check does not change
- I read the new tests `client/godot/core/ui_core/tests/test_dimmed.gd` and `client/godot/core/qa_core/tests/test_list_ui.gd` only for their use of UnitTestCore conventions. In `test_dimmed.gd` the frame waits before `prepare` follow the async wait rule, because `start` loads the test resources first (`client/godot/core/ui_core/tests/support/ui_test_case.gd:180`). The behavior of `is_dimmed` and `list_ui` `dimmed` against the `UICore` and `QACore` specs was not reviewed here, since those modules are outside this target
- I did not run the core tests of UnitTestCore, because this review has no finding to check. `ogw core test` also rewrites generated files of the core project in this checkout, and this review writes only the output file
- The rest of the range (`core-spec/UICore.json`, `records/`) is outside this client target. I read the `core-spec/UICore.json` diff, and it only adds the `is_dimmed` entry. UnitTestCore code outside the range was not reviewed, because the commit range limits the scope
