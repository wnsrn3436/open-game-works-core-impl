# review GameUpdateCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/game_update_core/deploy_list.gd:13: medium `is_version` rejects a version part longer than `_VERSION_PART_MAX_DIGITS` (18) digits, a bound that `game-update-core.md` `### deploy list` (version is `<major>.<minor>.<patch>`) does not set and that server `game-update` publish does not apply (`validation.parse_version`, `server/core/validation/helper.ts:108`, reads any number of digits). A deploy list published with `min_version` `1.0.1000000000000000000` for a platform makes `_check_platform_entry` (`deploy_list.gd:223`) fail with "platform entry version form", so every client of that platform gets `[game_update_invalid_file]` and the fetch failure popup on each retry until the operator publishes again. Present since 301b3dd8, not changed in the range

## debt

none

## must fix

none

## unknown

- The target code (`client/godot/core/game_update_core/`, `core-spec/GameUpdateCore.json`) has no change in the commit range. Read: the range changes that reach the target, which are server `game-update` (`is_below_min_version`, `server/core/game-update/cache.ts`, `index.ts`, `deploy_list.ts`), `client/godot/core/time_core/time_core.gd` (frame step, `make_random_seed`), `client/godot/core/log_core/log_core.gd` (comments only), `client/godot/generated/contract/core_contract.gd` (adds `LogoutOtherDevices` messages, no `CoreError` value change) and `client/godot/generated/core_settings.json` (no `GameUpdateCore.*` key change)
- Checked against server `is_below_min_version` ("the same judgement as the app version check of client GameUpdateCore"): `_check_app_version` (`game_update_core.gd:376`) compares the three numbers from the front as `compareVersions` does, no platform entry continues on both sides, and the platform names of `BootstrapCore` `_PLATFORMS` and `NetworkCore` `X-Ogw-Platform` equal the server `PLATFORMS` set. No divergence was found for versions that `is_version` accepts
- Frame step of TimeCore: the stall watch (`game_update_core.gd:600`, `:618`) reads `TimeCore.get_real_time`, which at a frame step follows engine frames instead of the monotonic clock (`time-core.md` `## DEV`). Every other client core timeout (e.g. `NetworkCore` request timeout, `network_core.gd:616`) reads the same clock, and the defining documents set no clock for `GameUpdateCore.stallTimeoutMs`, so it is not written as a finding
- Tests were not run: no finding needed a reproduction, and `ogw review run` runs the core tests after each fix. The GameUpdateCore core test result on the range end commit was not checked
- `BootstrapCore` `_is_version` (`client/godot/core/bootstrap_core/bootstrap_core.gd:739`) accepts leading zeros and unbounded digits in `app_version`, which `validation.parse_version` rejects or reads differently. `BootstrapCore` is outside the target, and whether a build can produce such an `app_version` was not checked
