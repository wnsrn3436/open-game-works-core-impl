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

- `client/godot/core/ad_core/`: no file changed in the commit range, so the module code was not read in full; only the reach of the changed code into AdCore was checked (`ad_core.gd` `set_ads_adapter`, `_unit_id`, the unit ID passed to `load_ad`, `present`, `open_banner`, and `adapters/admob_adapter.gd`)
- `server/core/ads-reward/callback.ts`, `deps.ts`, `adapter.ts`, `adapters/admob.ts`, `dev/adapters/fake.ts`: the range added the `ads-admob` ad unit check (`ad_callback_ad_unit`) against the parts after `/` of `environments.<ENV>.adUnits`. AdCore passes the full ad unit ID of build info `ad_units` to the adapter, and AdMob sends the part after `/` as `ad_unit`, which matches `skills/server-core/modules/ads-reward.md:81` and `:191`. The fake adapter `parse` returns an empty ad unit and the check runs only for `ads-admob`, so the AdCore fake flow (`tests/test_fake.gd`) is not reached by it. Whether build info `ad_units` and `environments.<ENV>.adUnits` hold the same ad unit IDs is decided by `ogw build run`, outside this target, and was not checked
- `settings/core-settings.json`, `client/godot/generated/core_settings.json`: the range raised `routing.ipRateLimitPerMinute` from 60 to 300 and added `storage.sweepBatchSize`, `storage.sweepTableBudgetMs`; no `AdCore.*` or `TimeCore.reachMarginMs` key changed
- `server/core/storage/`, `server/core/routing/`: the range changed the expiry sweep in batches; `ads-reward.ticketTtlMs` and the ticket `Expired` rule are unchanged, and AdCore tests do not depend on the sweep timing
- `client/godot/core/auth_core/tests/test_secure_storage_plugin.gd`, `client/godot/plugins/ogw-secure-storage/`, `client/godot/engine.json`: the range added a macOS secure storage plugin and its test; no AuthCore operation AdCore calls (`get_consent`, `report_ad_consent`, `is_logged_in`) changed
- `client/godot/core/qa_core/`: the range changed QACore telemetry; AdCore does not reference QACore
- Neither the AdCore core tests nor the `server/core/ads-reward` tests were run: the checkout has no `server/node_modules`, and no finding needed a run to be checked
