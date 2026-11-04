# review AdCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | client/godot/core/ad_core/ad_core.gd:417 | Input debt D1, unchanged (the commit range is empty). Run path: `show_banner(A)` sets `_banner_seq` 1, `_banner_target` A and awaits `open_banner` of A (line 413). `show_banner(B)` sets `_banner_seq` 2, `_banner_target` B and calls `open_banner` of B. A's `open_banner` ends `true`: `seq != _banner_seq` (line 416), and line 417 closes it only when `_banner_target == 0`, but it is B, so A's success is dropped without `close_banner` and `_banner_shown` stays 0. B's `open_banner` ends `false`: line 423 sets `_banner_target` 0. `hide_banner` then returns at line 310 (`_banner_target == 0`) without `close_banner`, and no later operation calls `close_banner` because `_banner_shown` is 0 (also `release` line 108). The SDK banner of A stays open with no way to close it, against "One banner is shown at a time" of spec `### banner` | When a superseded `open_banner` succeeds, always call `close_banner` unless that placement became the shown banner by then (e.g. close when `_banner_shown != placement_id`), or keep the late success as `_banner_shown` when the current target later fails; add a test for this run order on the recording adapter | no | 90 |
| R1-2 | test evidence | medium | client/godot/core/ad_core/ad_core.gd:257 | Input debt D2, unchanged. The `## error` row "`run_blocked` could not set a block → `Failed`. Releases the pause" has no test: no file in client/godot/core/ad_core/tests/ calls `InputBlockCore` in a way that makes `run_blocked` fail (the only references are `InputBlockCore.init` at tests/support/ad_test_env.gd:55 and `InputBlockCoreDev.list_active` at tests/support/ad_test_env.gd:265). Every `FAILED` assert in the tests (test_show.gd:61,193,251,264, test_placement.gd, test_lifecycle.gd:76,111, test_fake.gd:83, test_plugin_waits.gd:151) comes from placement check, `BeginAdReward`, `present`, `ClaimAdReward` or `release`, so removing the `if not step.ran` branch at lines 257-259 fails no test | Add a test in which `run_blocked` of `show` cannot set a block (e.g. the `ad` reason tag absent from the reason tag table, or a destroyed owner path per input-block-core) and assert `Failed`, no `present`, no sound pause and no active `ad` block | no | 90 |
| R1-3 | structure | medium | client/godot/core/ad_core/ad_core.gd:70 | Input debt D3, unchanged. `_fake_next_present`, `_fake_fails`, `_fake_skip_callback`, `_fake_delay_callback`, `_fake_delayed_notify_id`, `_fake_consent_required`, `_fake_consent_personalized`, `_fake_privacy_required` (lines 70-81, reset at lines 129-136) and also `_fake_present_ms` (line 40, set at line 92, read only at client/godot/core/ad_core/dev/adapters/fake_ads_adapter.gd:112) are used only by client/godot/core/ad_core/dev/ad_core_dev.gd, client/godot/core/ad_core/dev/adapters/fake_ads_adapter.gd and the AdCore tests. This DEV-only state is in the module class outside `dev/`, so it ships in STG and PROD builds, against `## DEV code` of open-game-works-core/skills/core/SKILL.md ("The DEV code of core is in `dev/` folders and is not included in STG and PROD builds"). In addition `FakeAdsAdapter` reads `AdCore._fake_*` (fake_ads_adapter.gd:25,26,31,43-45,52-54,63-67,87), while open-game-works-core/skills/client-core/engines/godot.md:157 allows `_` names only in the module class, `<Module>Dev` and the core tests | Move the fake state into DEV code (e.g. static vars of `AdCoreDev` or of `FakeAdsAdapter`, reset from DEV code), and have the fake adapter read `fakePresentMs` itself | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | ad_core.gd:401-424 and hide_banner at ad_core.gd:307-316 are the same as when the item was written; the run path in R1-1 still leaves A's banner open |
| D2 | open | R1-2 | No AdCore test makes `run_blocked` fail; the branch at ad_core.gd:257-259 is unchanged and uncovered |
| D3 | open | R1-3 | The `_fake_*` static vars are still at ad_core.gd:70-81 and reset at ad_core.gd:129-136 |

## must fix

none

## unknown

- The commit range e02d2bf..e02d2bf is empty, so no code changed in this round; the review covered only the input `## debt` items and the code they point to. The rest of AdCore was not reviewed again as a whole
- D1 was confirmed by tracing the code path; no test was run for it in this round. D2 was confirmed by searching the AdCore tests; the removal of lines 257-259 was not run again in this round
- The `ads-admob` native plugin behaviour (whether `open_banner` of a second unit replaces an open banner on the SDK side) was not checked; R1-1 holds at the AdCore state level either way, since AdCore loses track of A and `hide_banner` calls no `close_banner`
