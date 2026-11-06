# review BadgeCore round 1

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

- The commit range de482eec..9069447b changes no file of `client/godot/core/badge_core/` and no file of the modules in `## dependency` of the BadgeCore spec (LogCore, EventCore, TimeCore, ResourceCore, LocalDataCore, LocalizationCore, DataCore, UserStateCore, RequirementCore). The changed modules (CameraCore, PoolCore, QACore, ScreenEffectCore, SoundCore, TweenCore) and the settings changes (`QACore.frameIntervalMaxCount`, `QACore.rewardPresentationWindowMs` in `settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings*.json`, `server/core/testing/dev/setting_types.ts`) do not reference BadgeCore (`git diff` of the range has no `badge` match), so no change of the range causes or reveals a BadgeCore problem
- `client/godot/core/badge_core/badge_core.gd`, `badge_core_node.gd`, `badge_view.gd`, `badge_state.gd`, `badge_evaluator_result.gd`, `events/badge_changed_event.gd` and the test function list of `tests/` were read to look for out-of-scope problems; none of severity `medium` or above was found with confidence 80 or more
- The BadgeCore core tests were not run: no finding needed checking, and no file of the target changed in the range
- The callers of BadgeCore (`notice_core`, `chat_core`, `bootstrap_core`) were not read; they are outside the target and unchanged in the range
