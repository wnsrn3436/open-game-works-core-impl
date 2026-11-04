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

- Scope of this round: the commit range `6786a7f..dd0ed45` changes no file under `client/godot/core/ad_core/`, `core-spec/`, `proto/`, or any client module that AdCore depends on (`LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `DataCore`, `NetworkCore`, `UserStateCore`, `AuthCore`, `SoundCore`, `InputBlockCore`, `PaymentCore`) and does not change server `ads-reward`. The client code it changes is only `client/godot/core/realtime_core/`, which AdCore neither calls nor is called by.
- The two changed files that name ads keys do not reach AdCore: `settings/core-settings.schema.json` changes no `AdCore.*` or `ads-reward.*` entry, and `server/core/routing/tests/settings-minimum.test.ts` names `ads-reward` only in a comment on `idempotency.maxNotifyIdBytes`. `AdCore.sdkCallTimeoutMs` already has schema `minimum` 1, as the spec states.
- Tests not run: no AdCore test, core test or server test was run in this round, because the range does not change the target and there was no finding to check.
- Read outside the range, for possible `## out of scope` lines: `client/godot/core/ad_core/ad_core.gd`, `ad_call.gd`, `ad_request.gd`, `ad_show_step.gd`, `adapters/ads_adapter.gd`, `adapters/admob_adapter.gd`, `dev/ad_core_dev.gd`, `dev/adapters/fake_ads_adapter.gd`. This reading was not a whole-target review.
- Not read: the test files under `client/godot/core/ad_core/tests/`, the implementations of the depended-on modules, and the `ogw-ads-admob` plugin under `client/godot/plugins/`. The `test evidence` aspect and the plugin side of the adapter contract were not checked.
- Not judged: the three items of `records/review-debt/AdCore.json` (D1, D2, D3). Input `## debt` is `none`, so this review does not have them in scope. Their code did not change in the range, so this review gives no evidence that they are fixed.
