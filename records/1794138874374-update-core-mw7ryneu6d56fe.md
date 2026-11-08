# update core: logging

## done

- `logging` (server): `read_metrics` and the alert signals
  - `server/core/logging/metrics.ts` (new): class `Metrics`. It holds the families of `### metrics`:
    - `ogw_requests_total` by `request` (empty string for null) and decimal `error_code`
    - `ogw_request_duration_seconds` with buckets at the distinct values of `logging.metricsDurationBucketsMs` in ascending order, ÷ 1000, plus `+Inf`; cumulative `_bucket`, `_sum`, `_count`
    - `ogw_log_lines_total` by `kind` and level
    - the DB families from one `storage.read_db_metrics` call
    - `ogw_alert_firing` with one sample per alert signal (`error_ratio`, `slow_requests`, `error_logs`, `wal_archive`), judged over the lines written at a `clock_now` later than the judgement time − `logging.alertWindowMs`
    - Line families have no sample before their first line; the DB and alert families always have their samples. Label values are only request names, error codes, kinds, levels, DB failure kinds and alert names
  - `server/core/logging/index.ts`:
    - `write` hands each line it really writes to `Metrics`. Debug lines dropped in STG/PROD and `security` lines held back by a repeat window are not counted
    - The summary line of `logging_security_flush` is counted as `security`/`warn`
    - New operation `read_metrics()` reads `storage.read_db_metrics` once and judges at `server-time.clock_now`
    - `stop` clears the metrics
    - Exports `MetricFamily`, `MetricSample`, `AlertSignal`, `ALERT_SIGNALS`
    - Reads the 7 new settings keys
- `routing` (a caller change that this logging change needs): `server/core/routing/pipeline.ts` now measures `duration_ms` of the `request` log in real elapsed time rather than with `server-time.clock_now`
  - It uses the `server-time` system clock adapter (`create_system_clock`), as `storage/db/meter.ts` does, because the core static check forbids `performance.now()`
  - It covers `Exchange.started_at`, `elapsed_ms`, `handle_route`, `upgrade` and `route_log`
  - The end point is when `res.end()` returns, after the response bytes have been handed to the socket. For a WebSocket route it is when the route handler returns
  - The routing job of this update also edits `pipeline.ts`, so this may conflict at merge
- Tests:
  - `server/core/logging/tests/metrics.test.ts` (new, module level): Resync counts, buckets and lines per level with no user ID or IP in labels; families and types; buckets `[500, 100, 100]`; empty request label; DB families equal the `read_db_metrics` call they came from (spy); SQLite before any failure; every alert sample present before any line; stop clears; `error_ratio` with min 4 / 250 ‰ and window expiry; min-requests gate; `slow_requests` boundary; `error_logs` (count − 1 plus `request` error lines does not fire); `wal_archive`
  - `server/core/logging/tests/metrics-routing.test.ts` (new, over HTTP on a test server): a test clock moved inside the handler does not change `duration_ms`; `slow_requests` fires for a request that waits for a user row held by `testing.hold_db` (PostgreSQL) and not for two fast requests; labels of HTTP requests
  - `tests/helpers.ts`: `request` takes an optional `duration_ms`
- Runs:
  - `ogw core test server logging`: pass
  - `ogw core test server` on every server module that `ogw core dependents logging` lists (routing's dependents are included): all pass, on a clean checkout
  - `ogw code check core`: pass (type check, lint, dependency, secret)
- No engine-specific implementation rules document was written. `## <engine> build` of `tools/ogw.md` was not written

## spec proposals

- `request` label from the URL: in STG and PROD, a `POST /cheat/<name>` or `/core/cheat/<name>` gets a `request` log line whose `request` is `cheat/<name>` taken from the URL. In DEV, the same happens for unknown cheat names. So `ogw_requests_total` and `ogw_request_duration_seconds` get a label value the client chose, with no bound on how many there are. This conflicts with "Label values are only ... a request name". Proposal: `### metrics` uses one fixed `request` label (e.g. `cheat`) for a cheat path in an environment without DEV code and for a cheat name that is not registered. Alternatively, `routing` writes that fixed name as the `request` of such a line
- Real elapsed time: `duration_ms` and `storage`'s `sync_wait_ms` use the system clock adapter (`Date.now`), which is wall-clock time. A host clock step during a request changes `duration_ms` (it is clamped at 0). Proposal: `server-time` gets a monotonic real-time read, or the spec allows a monotonic clock outside the clock adapter, for real elapsed measurements
- Worker instances: the start of `duration_ms` ("when it receives the request from the front") has to be measured by the worker pipeline of `run_server_process`, which is not on main yet. Today the start is when the pipeline makes the exchange (`new_exchange`), right after dispatch

## review

none

## unverified

- Skipped test: `routing.create_server` with `logging.metricsDurationBucketsMs` `[]` should fail the settings check with keyword `minItems`. The test is written in `metrics-routing.test.ts` but marked `it.skip`. The reason is that the `create_server` settings check (`### server start` of `routing`) belongs to the routing job of this update and is not on main. I ran it without the skip: it fails on SQLite and PostgreSQL because the server starts. Remove `.skip` once the routing job is merged
- `routing_ops_report` and `/metrics` on the ops port are not on main, so `read_metrics` has no caller in production code yet. Summing over the server instances of a process is not checked
- In the `slow_requests` test, the request waits on a user row lock. It either ends after the release with 0, or with `INTERNAL` at `storage.userLockWaitMs` when the synchronous DB call blocks the thread. The test accepts both, since either way `duration_ms` is above `logging.alertSlowRequestMs`
- `wal_archive` firing `true` was checked only with a stubbed `read_db_metrics`, not with a real PostgreSQL archiver failure
