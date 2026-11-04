# review AdCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | client/godot/core/ad_core/ad_core.gd:392-395: a superseded `open_banner` success now always goes to `_drop_late_banner` (ad_core.gd:406-412), which calls `close_banner` and, when a later `show_banner` already opened its banner (`_banner_shown != 0`, which then equals `_banner_target`), opens that banner again with a new `_banner_seq`. The run path of R1-1 (A held, B held, A `true`, B `false`, `hide_banner`) now gives `open_banner`, `open_banner`, `close_banner` and `_banner_shown` 0, so no banner stays open (tests/test_banner.gd:81). Traced the further orders A held + `hide_banner` + A `true` (close, no reopen), A held + B opened + A `true` + `hide_banner` while the reopen is held (the late reopen is closed by the same branch) and A held + B opened + C held + A `true` (`_banner_shown` already 0 from C's close, so close and no reopen): none leaves a banner open that AdCore does not track. In a temporary worktree with the old branch `if opened.flag and _banner_target == 0: adapter.close_banner()` put back, `ogw core test godot AdCore --file client/godot/core/ad_core/tests/test_banner.gd` failed both new tests (`test_late_success_of_a_replaced_banner_while_the_new_one_opens_is_closed`, `test_late_success_of_a_replaced_banner_after_the_new_one_opened_opens_the_new_one_again`) |
| R1-2 | fixed | New test client/godot/core/ad_core/tests/test_show.gd:273 releases `InputBlockCore` before `show`, so `run_blocked` sets no block, and asserts `Failed`, the `InputBlockCore` error log, no AdCore error log, no `present`, no `BeginAdReward`, no `ad` block, no pause and a later `show` that completes. In a temporary worktree with the `if not step.ran` branch (ad_core.gd:233-235) removed, `ogw core test godot AdCore --file client/godot/core/ad_core/tests/test_show.gd` failed that test (`[1] expected to equal [0]`: the AdCore error log of `present failed` appears) |
| R1-3 | fixed | ad_core.gd has no `_fake_*` var and no `_fake_present_ms` any more; its only fake reference is the `AdCore.fakePresentMs` key in the `init` settings check (ad_core.gd:14,17). The fake state is now instance vars of `FakeAdsAdapter` in client/godot/core/ad_core/dev/adapters/fake_ads_adapter.gd:13-22, reset in its `release` (fake_ads_adapter.gd:94-104, called from `AdCore.release` at ad_core.gd:95), and set by `AdCoreDev` through `AdCore._adapter as _FAKE` (dev/ad_core_dev.gd:83-84). The fake adapter no longer reads `AdCore._` names; `AdCoreDev` reading `AdCore._adapter` is allowed by open-game-works-core/skills/client-core/engines/godot.md:157 |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same defect as R1-1, fixed by `_drop_late_banner` (ad_core.gd:392-412); see R1-1 in `## previous` |
| D2 | fixed | none | Same defect as R1-2; tests/test_show.gd:273 fails when the `if not step.ran` branch is removed; see R1-2 in `## previous` |
| D3 | fixed | none | Same defect as R1-3; the fake state is in dev/adapters/fake_ads_adapter.gd and no longer in ad_core.gd; see R1-3 in `## previous` |

## must fix

none

## unknown

- Other changes in the commit range are outside `client/godot/core/ad_core/` and in modules AdCore does not depend on (e.g. BootstrapCore, PaymentCore tests, PushCore); they were not reviewed. AdCore code outside the banner, `show` failure path and DEV fake parts was not reviewed again
- open-game-works-core/skills/client-core/engines/godot.md:529 says module state that DEV operations change (e.g. forced failure) is kept in `_` static vars of the module class. The fix keeps the `fake_*` values on the fake adapter instance instead, on the reading that this state is read only by the fake adapter and not by the module. Whether godot.md:529 also covers adapter state is not settled by the defining documents; it was not written as a finding (confidence below 80)
- The fake adapter now reads `AdCore.fakePresentMs` at each `present` (fake_ads_adapter.gd:132) instead of AdCore reading it in `init`; AdCore still checks the key in `init`. With file settings the value is the same; only test settings changed after `init` behave differently. Not written as a finding
- The `ads-admob` native plugin behaviour with overlapping `open_banner` calls (replace or stack) and with `close_banner` while another `open_banner` is in progress was not checked. The R1-1 fix is checked only at the AdCore state level on the recording adapter
- `## DEV` of the AdCore spec does not say what `fake_*` operations do when AdCore holds a non-fake adapter (the implementation does nothing, no log); this is the core agent's spec proposal and was not judged
- After the fixes, `ogw core test godot AdCore` passed on the review checkout; the `--web` run and the modules that depend on AdCore were not run in this review
