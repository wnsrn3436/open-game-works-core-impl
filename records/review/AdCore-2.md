# review AdCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit 0dcb8029 adds `test_release_before_init_deletes_the_ads_adapter_and_the_ad_units` (`client/godot/core/ad_core/tests/test_lifecycle.gd:116`): `set_ads_adapter(env.adapter, env.ad_units)` without `init`, `release`, then checks `_adapter` is `null`, `_ad_units` is empty, no adapter call, no `AdCore` error or warn log, and after `init` `get_ready_state` of `[ad_rewarded_basic]` and `[ad_interstitial_plain]` is `UNSUPPORTED`. Defect restored in a temporary `git worktree add --detach` of 96c83e35 by deleting the two lines `_adapter = null` and `_ad_units = {}` (and their comment) of the pre-init branch of `release` (`client/godot/core/ad_core/ad_core.gd:86-90`); `ogw core test godot AdCore --file client/godot/core/ad_core/tests/test_lifecycle.gd` failed with only that test failing: `Expected [<RefCounted>(recording_ads_adapter.gd)] to be NULL ; [13] expected to equal [0] ; [0] expected to equal [4] ; [0] expected to equal [4]`. The same command on the unchanged worktree passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range ac69510a..96c83e35 changes in AdCore only `client/godot/core/ad_core/tests/test_lifecycle.gd` (the new test and the file comment). No AdCore implementation, AdCore spec, `AdCore.*` settings key, `ads-reward` server file or ad proto changes in the range; the other changed code files (`client/godot/core/realtime_core/tests/test_lifecycle.gd`) and the records are outside the target
- AdCore code outside the changed places was not reviewed, because with a commit range only problems caused or revealed by the range are in scope
- Only `test_lifecycle.gd` of AdCore was run (headless, `godot`); the whole AdCore suite and `--web` were not run by this review. The core agent report states `godot` and `godot --web` of `AdCore BootstrapCore QACore UnitTestCore` passed
