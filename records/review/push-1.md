# review push round 1

## findings

none

## previous

none

## out of scope

- server/core/push/send.ts:522: medium `send_held_batch` selects due `push_held` rows with `expires_at > now` once (`now` taken at send.ts:496), then takes each row in its own game transaction with `DELETE FROM push_held WHERE push_id = $1 AND user_id = $2` that has no expiry condition, and sends every taken row. A row whose `expires_at` (`send_at` + `push.maxDelayMs`) is reached between the select and its take (the takes of up to `push.sendBatchSize` rows and `drop_held` run one after another before any send) is still taken and sent after `expires_at`. `storage` `### expiry` says a row with expiry column ≤ `clock_now` counts as a row that does not exist also before it is deleted, and `push` `### send` sends only when a row was deleted. The push source did not change in the range, so this existed before it

## debt

none

## must fix

none

## unknown

- The push source and tests (`server/core/push/`) did not change in the range. The range changes that push reaches are in `storage`: `sweep_expired` now deletes in batches per table with a time budget and returns the failed table list (`server/core/storage/rows.ts` `sweep_expired`, `sweep_sql`), `register_table` adds an index of the expiry column alone when no index starts with it (`server/core/storage/schema.ts` `with_expiry_index`), index creation uses `IF NOT EXISTS`, and the PostgreSQL free connection wait failure has its own code `POOL` and stays a lock failure (`FAILED`) (`server/core/storage/db/postgres.ts` `LOCK_CODES`). I checked them against push
  - `push_record` (indexes `(status, send_at)`, `(target_user_id, status)`, `(send_at)`) and `push_held` (`(send_at)`, `(user_id)`) have no index starting with `expires_at` (`server/core/push/store.ts:30`, `server/core/push/store.ts:33`), so each now gets an `(expires_at)` index. Push queries do not depend on the index list
  - Push reads of `push_record` that can meet finished records use `expires_at IS NULL OR expires_at > now` (`server/core/push/schedule.ts:14`, `server/core/push/schedule.ts:181`), and status updates touch only `SCHEDULED` or `SENDING` records, whose `expires_at` is null, so batch deletes that leave expired rows for a later run do not change push results. The `push_held` select filters `expires_at > now` (`server/core/push/send.ts:498`)
  - The PostgreSQL batch delete by `ctid` with the outer expiry condition does not delete a `push_record` row that a concurrent held result update (`server/core/push/send.ts:588`) rewrote; it only leaves it for a later batch or run
  - Before and after the range, a free connection wait over the limit is `FAILED` for push game transactions (`55P03` was already in `LOCK_CODES`), so the push retry path of `### send` is unchanged
- `ogw core test server push` passed on this checkout (SQLite default DB of the run). The PostgreSQL behavior of the batch sweep on push tables was checked by reading only
- `held_sending` (`server/core/push/send.ts:562`) reads the `push_record` row without the expiry condition. It reaches an expired record only when `push.recordRetentionMs` is shorter than the night window plus `push.maxDelayMs` (default 30 days), so I did not write it
- The storage, routing and other module parts of the range that push does not call (`routing` `storage_sweep` per-table error logs, `ads-reward`, `adUnits`, client changes) are outside this target and were not reviewed
