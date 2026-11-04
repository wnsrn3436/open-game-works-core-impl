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

- The commit range changes no file under `client/godot/core/unit_test_core/`, and no file under `fixtures/`, `test-data/` or `core-spec/UnitTestCore.json`. The review covered only the places where the changed code reaches UnitTestCore: the fake realtime transport (`client/godot/core/unit_test_core/dev/unit_test_realtime_transport.gd`), its base classes, `client/godot/core/unit_test_core/tests/test_realtime.gd`, `client/godot/core/unit_test_core/tests/test_replacements.gd`, and the use of UnitTestCore rules in the changed RealtimeCore tests. The rest of the UnitTestCore code and tests was not checked in this round, because it is outside the range and the changes do not reach it
- The items of `records/review-debt/UnitTestCore.json` (D1, D2, D3) are not in this round's input, so they were not checked and have no result here
- Run: `ogw core test godot UnitTestCore --file` passed for `test_realtime.gd` and `test_replacements.gd` in the native run. The other UnitTestCore test files, the browser run (`--web`) and the RealtimeCore core tests were not run in this review
- The changed RealtimeCore production code and tests were read only for their effect on UnitTestCore: the transport operations RealtimeCore calls, the fake transport contract, and the waits of `unit-test-core.md` `### async wait` (checked by reading the added loops in the changed tests). Their correctness against `realtime-core.md` was not checked. It belongs to the review of the RealtimeCore target
- The harness test host in the harness `tools/` was not checked, because the commit range is of `open-game-works-core-impl/` and does not reach it
