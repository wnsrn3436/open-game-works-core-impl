# BadgeCore review round 1

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

- The commit range `2ef5ae8..4bc36b7` changes no BadgeCore code or test. `git diff --name-only` shows no file under `client/godot/core/badge_core/`. It also changes no file of the BadgeCore dependency modules (LogCore, EventCore, TimeCore, ResourceCore, LocalDataCore, LocalizationCore, DataCore, UserStateCore, RequirementCore). The client changes are in `client/godot/core/auth_core/`, `client/godot/core/bootstrap_core/`, `client/godot/core/sound_core/` and `client/godot/core/tween_core/`, plus `client/godot/generated/contract/core_contract.gd` and `client/godot/generated/core_settings.json`
- Checked where the changed files reach BadgeCore. BadgeCore reads core settings only through `CoreSettings.has_string`/`get_string`/`has_int`/`get_int` (`client/godot/core/badge_core/badge_core.gd:806`, `:813`). The `core_settings.json` diff adds only `SoundCore.*`, `public-profile.findPerMinute` and `uiQuality` keys, and changes or removes no key. The contract diff adds `FindUserByPublicCodeRequest`/`FindUserByPublicCodeResponse` and fields in `BanDetail`, `AuthResult` and `PublicProfileEntry`. It does not change `ItemBalanceUserState`, `UserStateEntry` or `UserStateDelta`, which are the contract types the BadgeCore tests use (`client/godot/core/badge_core/tests/support/badge_test_case.gd:132`, `:140`, `:143`, `:147`)
- The BadgeCore test setup calls `SoundCore.init()` and `TweenCore.init()` (`client/godot/core/badge_core/tests/support/badge_test_case.gd:63`). `SoundCore._read_settings` now also needs `SoundCore.voiceDuckAttackMs`, `voiceDuckReleaseMs`, `sfxPitchVariationCents`, `sfxVolumeVariationDb` and `voiceDuckDb`. The generated `core_settings.json` has all five, and their values (150, 500, 50, 1.5, 9) pass the range check, so that init still returns `true`. SoundCore and TweenCore are not BadgeCore dependencies, so their own behavior is not reviewed here
- The BadgeCore core tests were not run in this review. The run needs the GUT setup, the test host and the core fixtures that `ogw core test` prepares, so whether they pass on `4bc36b7` is not checked here
