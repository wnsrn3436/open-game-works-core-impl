# review AdCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/ad_core/ad_core.gd:87 | Commit ad967246 adds the `release` path of an AdCore that is not initialized: it deletes the ads adapter and the ad units that `set_ads_adapter` (an operation the AdCore spec says is called before `init`, `skills/client-core/modules/ad-core.md:41`) set, as `skills/core/SKILL.md:73` requires. No test goes through this path: every `AdCore.release()` in `client/godot/core/ad_core/tests/` (test_lifecycle.gd:47, :60, :95, test_fake.gd:111, test_pacing.gd:176, test_plugin_waits.gd:51, :149, test_placement.gd:86) runs after `init`, the only test that reads `AdCore._adapter` after a release (`_assert_initial_state`, test_lifecycle.gd:21) releases an initialized AdCore, and the new `client/godot/core/bootstrap_core/tests/test_boot_shutdown_pre_init.gd` checks only `DataCore` and `ResourceCore`. Run path: `AdCore.set_ads_adapter(adapter, units)` without `init`, then `AdCore.release()`, then `AdCore.init()`: with the two added lines removed, `AdCore._adapter` is still `adapter` and `get_ready_state` of a placement with an ad unit is not `UNSUPPORTED`, and no test fails | Add a lifecycle test: `set_ads_adapter` with an adapter and ad units, `release` without `init`, then check `_adapter` is `null`, `_ad_units` is empty, no log, and after `init` a full-screen placement is `UNSUPPORTED` | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range 625ae189..ac69510a changes in `client/godot/core/ad_core/` only `release` of an AdCore that is not initialized (`ad_core.gd:86-90`). No AdCore spec, `core-spec/` entry, `AdCore.*` settings key, `ads-reward` server file or `BeginAdReward`/`ClaimAdReward`/`FakeAdCallback` proto changes. The AdCore DEV operations (`client/godot/core/ad_core/dev/ad_core_dev.gd`) work only after `init`, so they set no value before `init` that this path would need to delete
- The new path calls no adapter operation; dropping an adapter that never got `init` releases nothing: `AdmobAdapter` holds no per-object state outside `_life` and the process-wide `_sdk_ready`, and `FakeAdsAdapter` adds its overlay only in `present`, which needs `init`
- Changed code that AdCore calls: `AuthCore` (`client/godot/core/auth_core/auth_core.gd`) moves storage waits to `_storage_waits`, keeps DEV values across `release` and adds a pre-init clear; AdCore uses only `get_consent`, `get_user_id`, `is_logged_in` and `report_ad_consent`, which do not change. `BootstrapCore` `shutdown` now calls `AdCore.release` also when AdCore is not initialized, which reaches only the path above. `NetworkCore` and `PaymentCore` change only their own pre-init release. `LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `UserStateCore`, `SoundCore`, `InputBlockCore` and `UtilCore` do not change in the range
- The AdCore code outside the changed places was not reviewed, because with a commit range only problems caused or revealed by the range are in scope
- The AdCore core tests were not run; R1-1 rests on reading every `AdCore.release()` call and every read of `AdCore._adapter` in the client core tests
