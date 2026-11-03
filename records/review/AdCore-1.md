# AdCore review round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/ad_core/ad_core.gd:416: medium A replaced banner whose late `open_banner` succeeds is left open when the new banner then fails, and nothing can close it. `_run_banner` closes a late success only when `_banner_target == 0`, so while B is the target the success of A is dropped; when B's `open_banner` then fails, line 423 sets `_banner_target` to 0, and `hide_banner` returns at line 310 without `close_banner`. Reproduced with a temporary test on the recording adapter in a copy: hold two `open_banner`, `show_banner(A)`, `show_banner(B)`, finish A with `true`, finish B with `false`, `hide_banner`: 2 `open_banner`, 0 `close_banner`, `_banner_target` 0, `_banner_shown` 0. This differs from "One banner is shown at a time" of the `AdCore` spec `### banner`. The cause predates the commit range, which does not change `client/godot/core/ad_core/`
- client/godot/core/ad_core/ad_core.gd:257: medium The row "`run_blocked` could not set a block" of `## error` in the `AdCore` spec has no test (aspect `test evidence`). No file in `client/godot/core/ad_core/tests/` makes `run_blocked` fail. In a copy with the `if not step.ran` branch at lines 257-259 removed, all 69 existing AdCore tests still pass
- client/godot/core/ad_core/ad_core.gd:70: medium Fake adapter state that only DEV code uses is kept outside `dev/` (aspect `structure`). `_fake_next_present`, `_fake_fails`, `_fake_skip_callback`, `_fake_delay_callback`, `_fake_delayed_notify_id`, `_fake_consent_required`, `_fake_consent_personalized` and `_fake_privacy_required` (lines 70-81, reset at lines 129-136) are read and written only by `client/godot/core/ad_core/dev/ad_core_dev.gd`, `client/godot/core/ad_core/dev/adapters/fake_ads_adapter.gd` and the AdCore tests, apart from that reset. They ship in STG and PROD builds, which differs from the term DEV code of the harness document and from `## DEV code` of `open-game-works-core/skills/core/SKILL.md`, which keep such code in `dev/` folders

## debt

none

## must fix

none

## unknown

- `client/godot/core/ad_core/adapters/admob_adapter.gd` was read and its waits are covered by `tests/support/silent_admob_plugin.gd`, but it was not checked against the real plugin. `ogw-ads-admob` is not yet in `client/godot/plugins/` or `client/godot/engine.json`; `open-game-works-core/skills/client-core/engines/godot.md:54` says each such plugin is written in the `update core` a human orders for it. The behavior of the Google Mobile Ads and UMP SDKs, including how a late banner interacts with `close_banner`, was not checked
- The 69 AdCore tests were run only natively, once, in a temporary copy of `client/godot` at the end of the range, with Godot 4.7.2 and with `addons/` and `build/` copied from the main checkout, not through `ogw core test`. All passed. The browser run (`--web`) was not run
- The core tests of modules that depend on AdCore and of the modules AdCore depends on were not run. The range changes no file of `client/godot/core/ad_core/`, `core-spec/AdCore.json`, `core-spec/ads-reward.json` or `server/core/ads-reward/`. Of the range's client changes, these were read for their effect on AdCore: `payment_core.gd` (comment only), `core_settings.json` and `core_settings_types.json` (no `AdCore` key changed), `localization_core.gd` and `message_core.gd` (operations AdCore does not call)
- The server module `ads-reward` was checked only where AdCore meets it: the operations and fields in its spec, and the `custom_data` and `user_id` query names read by its AdMob adapter. It is not the target of this review
