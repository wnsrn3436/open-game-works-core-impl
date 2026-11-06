# review RequirementCore round 1

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

- The commit range de482eec..f7747731 changes no file under `client/godot/core/requirement_core/` and no RequirementCore spec, settings key or test. RequirementCore calls only LogCore, EventCore, TimeCore, UserStateCore, `CoreSettings` and the generated `GameData` (client/godot/core/requirement_core/requirement_core.gd:105, requirement_core.gd:114, requirement_core.gd:125, requirement_core.gd:378, requirement_core.gd:770); the range changes none of their files (`client/godot/core/core_settings.gd` and the generated data code are unchanged). The changed modules (QACore, PoolCore, SoundCore, TweenCore, CameraCore, ScreenEffectCore) are not RequirementCore dependencies, are not called by RequirementCore and do not call it. The modules that call RequirementCore (ShortcutCore, BadgeCore, TutorialCore) are not changed in the range
- The QACore settings keys added to `settings/core-settings.json` and `client/godot/generated/core_settings.json` (`QACore.frameIntervalMaxCount`, `QACore.rewardPresentationWindowMs`) do not touch the keys that RequirementCore reads (`RequirementCore.maxBatchRounds`, `RequirementCore.timeRecheckMs`, `TimeCore.reachMarginMs`)
- The RequirementCore code outside the changed places was not reviewed, because with a commit range only problems caused or revealed by the range are in scope
- The RequirementCore core tests were not run, because no finding needed checking
