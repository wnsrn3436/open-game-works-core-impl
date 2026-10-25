# NetworkCore review round 1

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

- The commit range 2ef5ae8d3d40c74ba1bc3385efee1c2c0591c772..74d478ff87c4b3deba0468b6eb9166ce3a58b820 changes no NetworkCore code, test or spec (`client/godot/core/network_core/`, `core-spec/NetworkCore.json`: `git diff --stat` of the range on those paths is empty). On the client it changes AuthCore, BootstrapCore, SoundCore, TweenCore, the generated contract `client/godot/generated/contract/core_contract.gd` (from `proto/ogw/core.proto`), the generated core settings files, `settings/core-settings.json`, `settings/core-settings.schema.json` and the specs `AuthCore`, `BootstrapCore`, `QACore`, `SoundCore`, `auth`, `public-profile`, `storage`. Of the modules in `## dependency` of the NetworkCore spec (`LogCore`, `EventCore`, `TimeCore`, `DataCore`, `UserStateCore`, `InputBlockCore`, `UICore`, `MessageCore`) and its server dependencies (`session`, `logging`), only test helpers of `session` and `logging` (`server/core/session/tests/session_kit.ts`, `server/core/logging/tests/helpers.ts`) change
- The contract change reaches NetworkCore only through `BanDetail`: `client/godot/core/network_core/network_core.gd:803` puts the decoded `envelope.error.ban` object into `RequestFailure.ban` as it is, as `skills/client-core/modules/network-core.md:45` and `:283` say, so the new field `public_code` (field 6) is carried without NetworkCore code. NetworkCore source does not refer to `AuthResult`, `PublicProfileEntry` or `FindUserByPublicCode*`; `client/godot/core/network_core/tests/test_headers.gd:109` builds an `AuthResult` without the new field, which decodes to the default empty string
- The test support `client/godot/core/network_core/tests/support/network_test_case.gd:73` and `:76` call `SoundCore.init` and `TweenCore.init`. `SoundCore._read_settings` now also requires `SoundCore.sfxPitchVariationCents`, `sfxVolumeVariationDb`, `voiceDuckDb` (number) and `voiceDuckAttackMs`, `voiceDuckReleaseMs` (integer, at least 1); `client/godot/generated/core_settings.json` has them as 50, 1.5, 9, 150, 500, so the setup still passes them. The TweenCore change is inside `_set_step_values` and `_apply_end_state` and does not change `init`. Judged from the code only; the NetworkCore core tests were not run in this review (the core project has no `addons/` here, which `ogw core test` fills)
- NetworkCore code and tests other than the places above were not reviewed line by line for problems outside the range, because they are not changed in the range and are not reached by the changes
