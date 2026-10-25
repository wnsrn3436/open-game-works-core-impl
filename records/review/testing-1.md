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

- In the range 2ef5ae8d..be197c82, the only change inside `server/core/testing/` is `server/core/testing/dev/setting_types.ts` (adds `SoundCore.sfxPitchVariationCents`, `SoundCore.sfxVolumeVariationDb`, `SoundCore.voiceDuckAttackMs`, `SoundCore.voiceDuckDb`, `SoundCore.voiceDuckReleaseMs`, `public-profile.findPerMinute`, `uiQuality`). I compared every row of `SETTING_TYPES` with the `settings` rows of all `core-spec/*.json`: 471 keys on each side, and every key and type matches. I checked the new keys against `settings/core-settings.schema.json` too (integer and number types agree). The one caller, `check_overrides` / `spec_type` in `server/core/testing/dev/test_server.ts:338`, is unchanged
- The storage changes in the range (`create_user` now returns `NewUser`, random user IDs, public codes, core schema version 2) do not reach the testing module. No file in `server/core/testing/` calls `create_user`, `get_user_record` or `public_code`, or queries the `user` table. Its tests check user IDs only with `toBeGreaterThan(0n)` (`server/core/testing/tests/request.test.ts:101`, `server/core/testing/tests/fake.test.ts:240`), so they make no assumption about sequential IDs
- I did not run the testing module tests: the checkout has no installed `node_modules` (`server/` and the root have none), so vitest could not run. Whether the module's tests pass at `be197c82` is not checked
- I did not review the changes in other modules in the range (storage, auth, routing, public-profile, client cores) beyond the parts the testing module calls; they are outside this target
