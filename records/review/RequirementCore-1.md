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

- The commit range `2ef5ae8..af8bb1b` changes no file of `client/godot/core/requirement_core/` and no file of the modules it depends on (LogCore, EventCore, TimeCore, DataCore, LocalizationCore, UserStateCore, NetworkCore, UICore). The changes it makes that RequirementCore can reach are additions only: `client/godot/generated/contract/core_contract.gd` (+119 -0: new fields on the ban, auth result and public profile messages, and the new `FindUserByPublicCodeRequest`/`FindUserByPublicCodeResponse` classes), `client/godot/generated/core_settings.json` (+13 -0: `SoundCore.*`, `public-profile.findPerMinute`, `uiQuality`) and `client/godot/generated/core_settings_types.json` (+7 -0). RequirementCore and its tests use only `CoreContract.TutorialProgressUserState`, `ItemBalanceUserState`, `ShopPurchaseUserState` and `UserStateEntry`, plus its own settings keys read in `requirement_core.gd:105`-`:113`, and the range changes none of these. So no change of the range reaches the target code, and the rest of the module code was not reviewed again
- The flag collection `_logged_types` was checked: `requirement_core.gd:115` fills it in `init` with a `false` value for every type, `:386`-`:389` only change an existing key, and `tests/test_error.gd:42`-`:63` asserts that frame code adds no key
- Core tests were not run
