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

- In the commit range, the only change under the `testing` target is `server/core/testing/dev/setting_types.ts:109` and `server/core/testing/dev/setting_types.ts:111`, which add `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs` as `integer`. A script compared every settings row of `core-spec/*.json` with `SETTING_TYPES`: both have the same 477 keys, all types match, and the keys are in sorted order. The lookup and type check in `server/core/testing/dev/test_server.ts:339` and `server/core/testing/dev/test_server.ts:343` handle `integer` keys without any change, so the new rows reach `start_test_server` settings override validation as the spec says (`testing.md` `## behavior`)
- The other changes in the range are client Godot core modules (QACore, SoundCore, TweenCore, PoolCore, CameraCore, ScreenEffectCore), records and settings files. They are outside the `testing` target and were not reviewed for findings
- Tests were not run: the checkout has no `package.json` or `node_modules` at its root or under `server/`, so `server/core/testing/tests/register.test.ts` and the other testing tests could not run here
