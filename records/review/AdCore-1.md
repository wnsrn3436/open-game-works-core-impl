# AdCore review round 1

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

- `client/godot/core/ad_core/`: no file of AdCore changed in the commit range, so the module code was not read in full; only its calls into the changed modules were checked (`SoundCore.request_pause`/`release_pause`, `AuthCore.is_logged_in`/`get_user_id`/`get_consent`/`report_ad_consent`, `NetworkCore.send`, `UserStateCore.get_ad_reward_count`/`get_user_created_at`, `InputBlockCore.run_blocked`, `BootstrapCore` calls of `AdCore.start` and `set_ads_adapter`)
- `client/godot/core/sound_core/sound_core.gd`: the range added SFX variation and voice duck. The signatures and behavior of `request_pause`/`release_pause` that AdCore uses are unchanged in the diff; the effect of the duck on the global pause during `show` was checked only by reading (`_sync_duck` treats a paused `Voice` bus as no voice), not by running tests
- `client/godot/core/auth_core/`, `client/godot/core/bootstrap_core/bootstrap_core.gd`, `proto/ogw/core.proto`: the range added `public_code`; no operation, message or settings key AdCore uses (`BeginAdReward`, `ClaimAdReward`, `FakeAdCallback`, `AdCore.*` settings) changed
- AdCore core tests were not run in this review
