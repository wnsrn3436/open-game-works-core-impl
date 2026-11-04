# review routing round 1

## findings

none

## previous

none

## out of scope

- server/core/storage/db/pg_worker.ts:287: medium On PostgreSQL, a lock wait of 0 fails every transaction even when it would wait for nothing, because `open_tx` throws `NO_FREE_CONNECTION` when `wait_ms < 1` and `wait_ms` is the lock wait itself when no connection wait happened. `settings/core-settings.schema.json` allows 0 for `storage.userLockWaitMs` and `storage.schemaLockWaitMs`, and `open-game-works-core/skills/server-core/modules/storage.md:141` and `:263` fail only when the wait exceeds the value. Reproduced on the adapter against PostgreSQL 18.6 with an idle pool: `PostgresAdapter.begin({lock_wait_ms: 1, first: null})` is ok, and `begin({lock_wait_ms: 0, first: null})` is `DbError` kind `lock` code `POOL` "the wait for a free PostgreSQL connection left nothing of the lock wait". `is_db_failure` makes kind `lock` the `FAILED` of a transaction, so by code path `storage.userLockWaitMs` 0 makes the rate counter `run_game_transaction` `FAILED` and each request that counts it `INTERNAL` (`routing.md:174`); SQLite does not have this path. `storage.schemaLockWaitMs` 0 goes through the same line at server start: the `core update` report `records/1793768289963-update-core-mw1nbqne990438.md` observed that message on PostgreSQL only, and `server/core/routing/tests/settings-minimum.test.ts` keeps that key at its default. The same test sets `storage.userLockWaitMs` to 0 and passes because it checks server start only

## debt

none

## must fix

none

## unknown

- The defect above was reproduced at the adapter level only. A full request on a server with `storage.userLockWaitMs` 0 on PostgreSQL was not run, because `ogw core test --file` takes only a file inside the checkout under review and this review does not write there. The `INTERNAL` result comes from reading the code path
- `server/core/routing/tests/settings-minimum.test.ts` was not mutation-tested in this review. Whether it fails with a period key at 0 rests on the code (`schedule_job` throws below 1) and on the per-key results in `records/1793768289963-update-core-mw1nbqne990438.md`. `ogw core test server routing` and the `--file` run of that test passed
- The `schedule_job` period keys were compared with the schema: all have minimum 1, including those of `ranking`, `user-snapshot-clone`, `remote-config`, `notice`, `p2p-signaling`, `push`, `game-update` and `migration`. Default values in `settings/core-settings.json` were checked against the schema minimums, with none below. Requests and jobs at the minimum values were not run for any key other than the lock wait above
- The range's changes to `iap`, `block-report`, `auth` and `RealtimeCore` were read only as far as routing reaches them. Their correctness, such as the lock order between `block-report.remove_user` and the other `remove_user` steps, is not checked here and belongs to the reviews of those modules
- `records/review-debt/spec-routing.json` D1 (`routing.bodyReadTimeoutMs` 0) is a spec list item and not in this input, so it has no result here. In the code, `server/core/routing/pipeline.ts:398` and `:776` clamp the limit to at least 1 ms, so step 2 does not reach the throw of `network_time_limit`
