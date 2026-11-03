# review: AdCore round 1

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

- The commit range changes no file under `client/godot/core/ad_core/`. Its only implementation change is `_restore_heading_types` of `client/godot/core/localization_core/localization_core.gd:714`, with its test and `records/` files. AdCore reaches `LocalizationCore` only through `AuthCore`, and `client/godot/core/ad_core/tests/support/ad_test_env.gd:59` calls `init`, `resolve_language` and `load_translation` of it. No file of AdCore uses a heading type or a theme, so that change does not reach AdCore.
- Run in this review: `ogw core test godot AdCore` passes on the target commit. The result was reused from a passing result of the same key, not run again. `--web` was not run here.
- The commit range is not `none`, so the whole target was not reviewed to the standard of a full review. `ad_core.gd`, its helper files, `adapters/`, `dev/` and the test names were read against the spec, and the bodies of the tests only in part: the tests of suppression, the rewarded preload before login, the preload limit and the `BeginAdReward` failures. `## out of scope` being `none` means that this reading found no problem, not that the target was checked in full.
- The native code of the `ogw-ads-admob` plugin is not in this repo, so the behavior of the plugin behind `client/godot/core/ad_core/adapters/admob_adapter.gd` was not checked. That includes what it does when `open_banner` of a second unit comes while the first is still opening, and whether a late first banner stays on screen when the second then fails. In that order `_run_banner` (`client/godot/core/ad_core/ad_core.gd:416`) discards the late success without `close_banner`, because `_banner_target` is not 0 at that time. Whether a banner stays open depends on the plugin, so this is not written as a finding.
- No real ads SDK was run. The core tests use the recording adapter, the fake adapter and `client/godot/core/ad_core/tests/support/silent_admob_plugin.gd`.
