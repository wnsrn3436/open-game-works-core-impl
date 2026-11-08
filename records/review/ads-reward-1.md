# review ads-reward round 1

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

- Inside `server/core/ads-reward/` the commit range changes only `tests/claim.test.ts` and `tests/fake-callback.test.ts` (commits c0ce46e6, be76a29c, 55d5be70). The new tests match `## test` item 1 of the ads-reward spec and line 311 of the routing spec (`step 11 field validation: notify_id: nul`), and they fail if the `nul` rule of the validator is removed, because the handler then answers `AD_REWARD_NOT_FOUND` (`is_notify_id` in `server/core/ads-reward/index.ts`). In `server/core/routing/pipeline.ts` the prepare `wait_ad_reward` runs after step 11 (`decode`), so a notify ID with U+0000 reaches neither `wait_ad_reward` nor the handler
- The storage changes of the range (`db/meter.ts`, `db/sqlite.ts`, `index.ts`, `tx.ts`) and the routing changes were read only where ads-reward calls them (`run_user_transaction`, `db`, `read_db`, the step 11 detail, the prepare order). The rest of those modules is outside this target and was not reviewed
- `ogw core test server ads-reward` ran twice (jobs mw7vy8z30b431e and mw7w8fsdc4d3e5; the second passed 162 of 168 tests). Every failure was in the postgresql run, and the failing tests differed between the two runs: a PostgreSQL connect over its time limit, `DevLogin` failing with `rate limit: rate counter transaction failed` or `handler: INTERNAL`, and HTTP 500 without a ResponseEnvelope. The failures come from setup steps outside ads-reward code (`DevLogin`, the routing rate counter, the storage connect), and the host load average was about 42 during the runs. The cause was not reproduced or checked, so the postgresql results of those tests are unknown. The sqlite run and the two U+0000 tests passed
