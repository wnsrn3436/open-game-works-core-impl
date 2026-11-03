# review testing round 1

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

- `server/core/testing/` was read only where the range reaches it: `dev/setting_types.ts` (the only file of the target changed in the range), its caller `check_overrides` with `spec_type`, `has_type` and `plan_of` in `dev/test_server.ts`, `dev/runner_input.ts`, `dev/core_test_server_input.ts` and `tests/setting-types.test.ts`. The other files of the target are unchanged in the range and were not audited. The core tests of the target were run instead (`ogw core test server testing`, pass)
- `server/core/routing/tests/server-image.test.ts`, new in the range, calls `core_test_server_paths`, `new_core_test_server_input` and `core_test_register`. Those calls were compared with the code by reading, and this test was not run: it builds Docker images and belongs to target `routing`
- `coupon.maxCodePicks` and `matchmaker.roomCodeMaxPicks` as settings overrides were run only through `server/core/coupon/tests/admin.test.ts` and `server/core/matchmaker/tests/rooms.test.ts` (both pass). The behavior of those keys in `coupon` and `matchmaker` was not reviewed: it belongs to those targets
- The removal of `uiCheckScreens` and `uiQuality` from the settings type table was compared with `core-spec/` and `settings/` of this checkout. `tools/tests/game/settings.json` still has `uiCheckScreens`; that file is outside this target and whether it should was not checked
