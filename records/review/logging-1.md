# review logging round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | efficiency | medium | server/core/logging/metrics.ts:262 | `#prune` runs on every `Metrics.line` (called synchronously from `logging.write` for every log line, `server/core/logging/index.ts:280`) and, whenever at least one leading slot leaves the alert window, replaces `#slots` with `this.#slots.slice(drop)`, a copy of every slot still in the window. Under steady load each new `clock_now` ms drops about one slot, so each line copies an array whose length is the number of distinct ms with lines in `logging.alertWindowMs` (default 300000, `settings/core-settings.json:517`). `alerts` (`metrics.ts:276`) also walks every slot on each `read_metrics`. Measured with `node --experimental-strip-types` on `Metrics` directly: fill the window with one `request` line per ms, then time 3000 more lines at one per ms: 4.4 µs per line at window 3000, 34.4 µs at 30000, 1247.4 µs at 300000. With the default window one line costs about 1.2 ms of the event loop, so at 1000 lines/s the server instance spends the whole second in `#prune` | Drop old slots without copying the rest (a head index into the array, compacted when the head passes half its length, or a ring buffer), and keep running totals of `requests`, `internal`, `slow`, `error_logs` that are added on `line` and subtracted on drop, so `line` is amortized O(1) and `alerts` subtracts the slots at or before its cutoff from the totals instead of summing the window | no | 90 |
| R1-2 | spec | medium | server/core/logging/index.ts:230 | `### metrics` of the logging spec says `ogw_log_lines_total` counts the server log lines written "summary lines of job `logging_security_flush` included". `summary_line` counts them with `metrics.line(now, 'security', 'warn', null)`, but no test reads `ogw_log_lines_total` after a summary line: `server/core/logging/tests/metrics.test.ts:86-89` count only `request`, `error` and one first `security` line written by `write`, and the summary-line tests in `server/core/logging/tests/server-log.test.ts:198,241` do not call `read_metrics`. Removing line 230 leaves every test passing | Add a test that writes N ≥ 2 grouped `security` lines, moves the test clock by twice `logging.securityRepeatWindowMs`, runs `wait_background`, and checks that `ogw_log_lines_total` for `kind` `security`, `level` `warn` is 2 (the first line and the summary line) | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- No test was run: the checkout has no `server/node_modules`, and `ogw core test` was not run. R1-2 is judged from reading every test file under `server/core/logging/tests/` (grep for `ogw_log_lines_total`, `repeated`, `logging_security_flush`), not from running the suite with line 230 removed
- The measurement of R1-1 ran `server/core/logging/metrics.ts` alone in Node v26.10.0 on this host, not inside a server instance
- `metrics-routing.test.ts` `slow_requests` case needs PostgreSQL and was not run
- How `routing` measures `duration_ms` (`server/core/routing/pipeline.ts:66-79`), sums `read_metrics` over the server instances and serves `/metrics` on the ops port belongs to the `routing` target and was read only as far as the `request` field and `duration_ms` it passes to `logging.write`
- The defaults of `logging.metricsDurationBucketsMs` and `logging.alert*` in `settings/core-settings.json` (commit c8fe1d02) were not judged for their values; the spec sets no value for them
