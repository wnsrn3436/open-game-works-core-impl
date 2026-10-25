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

- The only change of the testing module in the range is the two rows `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`integer`) added to `server/core/testing/dev/setting_types.ts:58` and `server/core/testing/dev/setting_types.ts:60`. They match the two rows added to `core-spec/LocalizationCore.json:41` and the `## settings` rows of `LocalizationCore` in the client core module spec. A script that reads every `settings` row of `core-spec/*.json` and every row of `SETTING_TYPES` found 464 rows on both sides with the same key and type, which is the comparison that `server/core/testing/tests/register.test.ts:54` makes
- `server/core/testing/tests/register.test.ts` itself was not run: the checkout has no test runner installed (no `node_modules`), so the test result is not checked
- The rest of the testing module (test server, peer process, fixtures, clock, realtime helpers) was not changed in the range and was not reviewed
