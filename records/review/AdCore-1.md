# review AdCore round 1

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

- The commit range 85f6b36d..9808fd47 changes no file under `client/godot/core/ad_core/` and no AdCore spec, settings key or test. `client/godot/generated/core_settings.json` and `settings/core-settings.json` change no `AdCore.*` key, and `proto/ogw/core.proto` does not change `BeginAdReward`, `ClaimAdReward` or `FakeAdCallback`. No file of `NetworkCore`, `UserStateCore`, `LocalDataCore`, `DataCore`, `EventCore`, `InputBlockCore`, `UtilCore`, `PaymentCore` or `BootstrapCore` changes in the range
- Changed code that AdCore calls, checked against the AdCore calls (`client/godot/core/ad_core/`): `AuthCore` (`client/godot/core/auth_core/auth_core.gd`) adds `logout_other_devices` and changes the pending token handling of `link_account`; AdCore uses only `get_consent`, `get_user_id`, `is_logged_in` and `report_ad_consent`, which these changes do not touch. `SoundCore` (`client/godot/core/sound_core/sound_core.gd`) adds `reset_volume_settings` and changes the variant random seeds of `init`; `request_pause` and `release_pause`, the only SoundCore operations AdCore uses besides `is_initialized`, do not change. `LogCore` (`client/godot/core/log_core/log_core.gd`) changes only comments
- `TimeCore` (`client/godot/core/time_core/time_core.gd`) adds `make_random_seed` (not used by AdCore) and the DEV frame step, which changes real elapsed time per engine frame only when `set_test_frame_step` was called or a DEV build runs with `--fixed-fps` or Movie Maker. Real elapsed time is read by the `AdCore.sdkCallTimeoutMs` wait of the `ads-admob` adapter (`client/godot/core/ad_core/adapters/admob_adapter.gd:146`) and the `AdCore.fakePresentMs` wait of the fake adapter (`client/godot/core/ad_core/dev/adapters/fake_ads_adapter.gd:133`); at a frame step both measure frame-stepped real elapsed time, which is what the TimeCore spec sets for real elapsed time and what makes a recorded fake ad last `AdCore.fakePresentMs` of recorded frames. `get_server_time` and `is_reached`, used by pacing, do not follow the frame step
- The server changes of the range (routing `duration_ms` clock, storage seed provider and `make_seed`, other modules) do not change the `ads-reward` module or the handling of `BeginAdReward`, `ClaimAdReward` and `FakeAdCallback`; the server code of these changes was read only as far as needed to see that
- The AdCore code outside the changed places was not reviewed, because with a commit range only problems caused or revealed by the range are in scope
- The AdCore core tests were not run, because no finding needed checking
