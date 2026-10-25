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

- In the commit range d4e2728f..c6a1194, the only change under `server/core/testing/` is two generated rows in `server/core/testing/dev/setting_types.ts` (`QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs`). Checked by script: every `settings` row of every `core-spec/*.json` has the same key and type in `SETTING_TYPES`, with no extra keys (473 keys, 0 differences). `check_overrides` in `server/core/testing/dev/test_server.ts:335-339` reads the table unchanged
- Changed code in the range that testing could reach: `server/core/auth/login.ts`, `server/core/auth/deletion.ts` and `server/core/auth/dev/index.ts` change only auth failure paths (`create_user` / `claim_key` return a failure instead of `null`). No file under `server/core/testing/dev/` imports these files. The auth-side behavior belongs to the AuthCore/auth review and was not checked here
- `server/core/testing/tests/setting-types.test.ts` was not run: this checkout has no `server/node_modules`. Its result for the new rows was not observed
- The rest of the testing module, outside the commit range, was not reviewed (the commit range is not `none`)
