# review: ads-reward round 1

## findings

none

## previous

none

## out of scope

- open-game-works-core/skills/server-core/modules/ads-reward.md:80: medium The spec does not set the order of the two checks on a callback whose signature matched: the reward notify ID and user ID format check (line 80, `warn` log) and the `ads-admob` ad unit check (line 81, `security` log `ad_callback_ad_unit`). An AdMob callback with an ad unit not in `adUnits` and a `custom_data` that is not a lower-case UUID v4 (e.g. the callback of another publisher's ad unit) can leave either log kind depending on the implementation. The code runs the format checks first (`server/core/ads-reward/callback.ts:177`), so such a callback leaves only a `warn` log and no `ad_callback_ad_unit` security line. The spec should name the order

## debt

none

## must fix

none

## unknown

- The range changes `server/core/ads-reward/` with commit 925fbce (the ad unit check). Checked: `parse` of `ads-admob` returns `ad_unit` decoded or empty (`server/core/ads-reward/adapters/admob.ts:51`), `parse` of `fake` returns empty (`server/core/ads-reward/dev/adapters/fake.ts:60`); `read_settings` takes the part after `/` of every ad unit ID of every placement and platform (`server/core/ads-reward/deps.ts:100`), which matches the game settings shape placement ID name → platform → ad unit ID that the build tool and `bootstrap-core` use; `routing` gives `environments.<ENV>.adUnits` the environment's value, and `{}` on LOCAL (`server/core/routing/spec_tables.ts:193`, `server/core/routing/start_parts.ts:101`); the check runs only for `ads-admob`, after the signature, before `claim_notify` and any transaction, rejects an empty ad unit, leaves no IP count and answers HTTP 200 (`server/core/ads-reward/callback.ts:175`). The new test `callback.test.ts` "answers HTTP 200 without a grant and with a security log ..." fails when the check is removed, by reading: the first callback would grant and `balance` would be 10, not 0
- The tests were not run and no defect was restored in a temporary copy: this worktree and `open-game-works-core-impl/` have no installed `node_modules`, and core tests run through `ogw core test`
- The storage changes of the range (batched `sweep_expired`, the added expiry column index from `register_table`) also reach the two ads-reward tables (`server/core/ads-reward/tickets.ts:24`). ads-reward does not call `sweep_expired` and does not depend on the index list; the effect of the added index on existing DB schemas is a `storage` question and was not reviewed here. The `routing.ipRateLimitPerMinute` default change does not reach the callback route, which does not go through the request processing order
- The rest of the module, which the range does not change or reach, was not reviewed as a whole. Client `AdCore` was not reviewed
