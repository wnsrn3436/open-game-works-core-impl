# AdCore review round 1

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

- `client/godot/core/ad_core/`, `server/core/ads-reward/`, `core-spec/AdCore.json`, `proto/`, `client/godot/core/bootstrap_core/`: no file changed in the commit range, so the module code was not read in full; only the reach of the changed code into AdCore was checked
- `client/godot/core/auth_core/tests/`: the range only removed `check_logs("error", "AuthCore")` asserts from AuthCore tests; no AuthCore operation AdCore calls changed
- `server/core/auth/login.ts`, `server/core/auth/deletion.ts`, `server/core/auth/dev/index.ts`: the range changed `create_user` and `claim_key` failures to return a typed failure; `server/core/ads-reward/` imports nothing from `auth`, so the changes do not reach the AdCore server dependency
- `client/godot/core/ui_core/ui_core.gd`: the range added `UICore.is_flow_in_progress`; AdCore and its tests do not reference UICore
- `client/godot/core/unit_test_core/dev/`: the range added the `PUT /started` start signal before the first test; the UnitTestCore helpers AdCore tests use (`advance_clock`, `wait_frames`, `check_logs`) are unchanged in the diff
- `settings/core-settings.json`, `client/godot/generated/core_settings.json`: the range added `QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs` and renamed `uiQuality.settleMs` to `settleLimitMs`; no `AdCore.*` key changed
- AdCore core tests were not run in this review
