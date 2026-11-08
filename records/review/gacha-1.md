# review: gacha round 1

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

- The commit range `85f6b36d..bb373018` changes no file under `server/core/gacha/`. The review covered the changes in the modules gacha calls and that its tests use: `server/core/item-ledger/history.ts`, `ledger.ts`, `index.ts` (history counter, separate `item-ledger.onceKeyRetentionMs`), `server/core/storage/index.ts`, `core.ts`, `tx.ts`, `db/sqlite.ts`, `dev/index.ts` (seed provider signature `(request_id, user_id, request_name)`, `make_seed`, DB meter), `server/core/logging/index.ts` (metrics fed from `write`), `server/core/routing/pipeline.ts` (real-clock `duration_ms`, min version check) and `server/core/testing/dev/test_server.ts`. None of them changes a result gacha relies on: gacha's `subtract_items` passes an empty `once_key`, its grant `once_key` `gacha:<request ID>` now lives for `item-ledger.onceKeyRetentionMs` (default 7776000000, the same as the earlier shared retention), the test seed provider `seed_of` still takes the request ID as its first argument, and `logging.write`/`track_core_event` keep their inputs and outputs
- `server/core/gacha/records.ts:35` still takes `draw_seq` from the largest unexpired `draw_seq` + 1 with an overwriting upsert, the pattern that the range replaced with a counter in `item-ledger`. The gacha spec (`### draw record`) and the `### expiry` upsert rule of `storage` still define it this way, and this review has no spec diff for gacha, so it is not a finding
- `ogw core test server gacha` was run twice at `bb373018`. The first run failed four PostgreSQL tests (`draw.test.ts` "is GACHA_BANNER_UNAVAILABLE before start_at…" and `history.test.ts` "max_rows outside 1 to gacha.maxHistoryRows…" with `core/cheat/DevLogin` failing with code 8 or HTTP 500, `history.test.ts` "rows past the retention period are gone" with `wait_background did not end within 10000 ms`, and `rates.test.ts` "1000 SINGLE DrawGacha calls…" with `RunCoreTest failed with code 8`) while the host load average was about 30 to 40. The second run passed on SQLite and PostgreSQL. The failures were in `auth` `DevLogin` and in timeouts, not in gacha assertions, and their cause was not reproduced, so whether they come from host load or from a defect outside gacha is not known
- Client modules were not reviewed: gacha is a server module and the range changes no gacha client code
