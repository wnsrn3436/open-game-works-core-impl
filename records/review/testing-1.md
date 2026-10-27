# review testing round 1

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

- In the commit range cf89b7fd..67d486d, the only change under `server/core/testing/` is two generated rows in `server/core/testing/dev/setting_types.ts:460-461` (`storage.sweepBatchSize`, `storage.sweepTableBudgetMs`, both `integer`), from commit 8ce8c2b. Checked by script: every `settings` row of every `core-spec/*.json` has the same key and type in `SETTING_TYPES`, with no extra keys and no key with two types (475 keys, 0 differences). The new `environments.<ENV>.adUnits` row of `core-spec/ads-reward.json` was already in `SETTING_TYPES` (`server/core/testing/dev/setting_types.ts:246`). `check_overrides` in `server/core/testing/dev/test_server.ts:339` reads the table unchanged
- Changed code in the range that testing could reach: `storage.sweep_expired` (`server/core/storage/rows.ts`) now deletes in batches and returns `{deleted, failed}`, and `routing` `storage_sweep` (`server/core/routing/routing_module.ts:156-170`) logs one error per failed table. No file under `server/core/testing/` calls `sweep_expired`, `schedule_job` of `storage_sweep`, or refers to `NO_FREE_CONNECTION` / `55P03` (`server/core/storage/db/pg_messages.ts`). The delete condition of an expired row (`expiry <= now`) is unchanged, so `server/core/testing/tests/background.test.ts:21-70` (`## test` item on `storage_sweep`) still describes the behavior. The per-table budget of `sweep_expired` uses `network_time_limit` (real-time, `unref` timer, `server/core/server-time/network_time_limit.ts`); it does not keep the process alive and does not move the test clock. The batch and budget behavior itself belongs to the storage review and was not checked here
- The core settings default `routing.ipRateLimitPerMinute` changed from 60 to 300 (`settings/core-settings.json:95`). No test under `server/core/testing/tests/` relies on the IP rate limit default
- No test was run: this checkout has no `server/node_modules` (nor does `open-game-works-core-impl/server/`). The results of `server/core/testing/tests/register.test.ts` (settings type table test) and `server/core/testing/tests/background.test.ts` with the new rows and the batch sweep were not observed
- The rest of the testing module, outside the commit range, was not reviewed (the commit range is not `none`)
