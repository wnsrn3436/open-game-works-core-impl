# TutorialCore review round 1

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

- The commit range `2ef5ae8..899384f` changes no file of `client/godot/core/tutorial_core/` and no TutorialCore spec (`core-spec/TutorialCore.json` is unchanged). The client changes are in `client/godot/core/auth_core/` (public code), `client/godot/core/sound_core/` (pitch and volume variation, voice duck), `client/godot/core/tween_core/` (arranged element offset transform), `client/godot/core/bootstrap_core/`, `client/godot/generated/contract/core_contract.gd` and `client/godot/generated/core_settings*.json`. UICore, RequirementCore, SceneCore, UserStateCore, NetworkCore, InputCore, InputBlockCore, LocalizationCore, DataCore, EventCore, TimeCore, LogCore, ResourceCore, SafeAreaCore and MessageCore are not changed by the range
- AuthCore: TutorialCore calls only `AuthCore.is_logged_in` (`client/godot/core/tutorial_core/tutorial_core.gd:438`), and its tests call `AuthCore.init`, `AuthCore.release` and `AuthCoreDev.dev_login` (`client/godot/core/tutorial_core/tests/support/tutorial_test_case.gd:93`, `:149`, `:211`). The range only adds `public_code` to the session, `LoginResult` and the new `get_public_code` (`client/godot/core/auth_core/auth_core.gd:721`, `:803`); `is_logged_in` and the login path the tests use are unchanged. The test `AuthResult` without `public_code` (`client/godot/core/tutorial_core/tests/support/tutorial_test_case.gd:201`) gives an empty public code, which TutorialCore does not read
- Contract: the generated contract changes only `BanDetail`, `AuthResult`, `PublicProfileEntry` (field `public_code`) and adds `FindUserByPublicCodeRequest`/`Response`. `TutorialProgressUserState`, `SaveTutorialProgressRequest`/`Response`, `ResponseEnvelope` and `UserStateDelta` that TutorialCore and its tests use (`client/godot/core/tutorial_core/tutorial_core.gd:356`, `:828`) are unchanged
- SoundCore: TutorialCore code does not call SoundCore; its tests call `SoundCore.init` and `release` (`client/godot/core/tutorial_core/tests/support/tutorial_test_case.gd:95`, `:147`), and UICore plays a button sound (`client/godot/core/ui_core/ui_core.gd:2100`). The new settings that `SoundCore._read_settings` requires are in `client/godot/generated/core_settings.json` (`SoundCore.sfxPitchVariationCents` to `SoundCore.voiceDuckReleaseMs`), and the TutorialCore tests do not override them
- TweenCore: TutorialCore code does not call TweenCore; UICore plays open and close presets on panels and popups (`client/godot/core/ui_core/ui_core.gd:531`, `:1251`, `:1593`). The changed behavior applies only to a `Control` whose parent is a `Container` (`client/godot/core/tween_core/tween_core.gd:1021`), and the TutorialCore test scenes (`client/godot/core/tutorial_core/tests/resources/`) contain no `Container`. Whether `UICore.get_anchor_rect` (`client/godot/core/ui_core/ui_core.gd:714`, `get_global_rect`) follows the offset transform of an arranged anchor element during a tween is a UICore question and was not checked
- BootstrapCore is not called by TutorialCore or its tests, so its change does not reach TutorialCore
- The core tests were not run in this review (running Godot would write the import cache into the checkout); the conclusion that the TutorialCore tests still pass after the range is from reading the code above
- The rest of TutorialCore code and tests, which the range does not change and which the changes do not reach, was not reviewed
