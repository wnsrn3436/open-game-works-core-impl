# RealtimeCore review round 1

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

- The commit range 2ef5ae8d3d40c74ba1bc3385efee1c2c0591c772..55dd4a63288701be81931898c8cf966fa63ebcfc changes no RealtimeCore code, test or spec (`client/godot/core/realtime_core/` and `core-spec/RealtimeCore.json` are not in the diff). Of the modules in `## dependency` of the RealtimeCore spec, only AuthCore changes: `public_code` is added to `AuthSession` and `LoginResult`, filled from `AuthResult.public_code` and `BanDetail.public_code`, and `get_public_code` is added (`client/godot/core/auth_core/auth_core.gd:721`, `:737`, `:759`, `:765`, `:803`, `:1543`). RealtimeCore calls only `AuthCore.get_user_id`, `get_access_token` and `refresh_access_token`, whose code is not changed in the range, so the change does not reach RealtimeCore behavior
- The contract change (`proto/ogw/core.proto`: `BanDetail.public_code`, `AuthResult.public_code`, `PublicProfileEntry.public_code`, `FindUserByPublicCode`) touches no message RealtimeCore uses (`MatchmakerFrame`, `MatchmakerFrameKind`, `MatchPlayer`, `MatchFailReason`, `RoomStatus`, `Transport`, `TransportRelay`, `CoreError`); `CoreError` gains no value in the range
- The RealtimeCore test setup reaches changed code through `SoundCore.init` (`client/godot/core/realtime_core/tests/support/realtime_test_case.gd:124`), which now also reads `SoundCore.sfxPitchVariationCents`, `sfxVolumeVariationDb`, `voiceDuckDb`, `voiceDuckAttackMs`, `voiceDuckReleaseMs`; all have defaults in `settings/core-settings.json:476` and `client/godot/generated/core_settings.json:476`, and `set_settings` (`realtime_test_case.gd:94`) does not override them. The fake `DevLogin` result (`realtime_test_case.gd:147`) leaves `AuthResult.public_code` empty, which AuthCore only stores. Read only, not checked by running the RealtimeCore tests
- RealtimeCore code and tests outside those paths were not reviewed: they are not changed in the range and are not reached by the changes, so their pre-existing problems are outside this review
