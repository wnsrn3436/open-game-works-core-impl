# review logging round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | server/core/logging/metrics.ts:209 | `### alert signal` of the logging spec counts the lines written at a `clock_now` later than the judgement time − `logging.alertWindowMs`. Commit 0eeee6c0 makes `alerts` call `#prune(now)`, so a judgement drops the slots at or before its cutoff for good. Before this range, `alerts` only skipped them. With the test clock (`testing.set_time` moves it to any time, also back, `server/core/testing/dev/test_clock.ts:31`), a judgement after the clock went back no longer sees lines that are in its window. Reproduced on `Metrics` directly (`node --experimental-strip-types`): window 100, `alert_error_log_count` 1, one `error` line at 1001, `alerts(1050)` gives `error_logs` true, `alerts(2000)` false, then `alerts(1050)` gives false. The same run on f6c7ed6b gives true. Through the public API: `write` an `error` log, `read_metrics` after `set_time` to 2 × window later, `set_time` back into the window, `read_metrics`: `ogw_alert_firing{alert="error_logs"}` is 0 where the spec gives 1. `metrics-window.test.ts:82` only judges at a time that never goes back (`latest` only grows), so no test covers this | Do not drop slots in `alerts`. Take the slots from `#head` that are at or before the cutoff away from a copy of `#totals`, without moving `#head`. This costs O(slots at or before the cutoff), and the next `line` drops those slots anyway. Or settle the clock-going-back case in the spec together with the out-of-scope item on `#slot` | no | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `#prune` (`server/core/logging/metrics.ts:187`) moves `#head` and takes each dropped slot away from `#totals`. It copies the array only when the dropped slots are at least half of it, and `alerts` reads `#totals` (`:209-210`), so `line` is amortized O(1). Restored the round-1 `metrics.ts` from f6c7ed6b into a `git worktree add` copy of HEAD and ran `ogw core test server logging --file server/core/logging/tests/metrics-window.test.ts`: `writes a line at a cost that does not grow with the lines in the window` failed on sqlite (955 ms ≥ 300) and on postgresql (893 ms). The same file passes on HEAD. The randomized comparison at `metrics-window.test.ts:82` and the boundary test at `:123` also pass on HEAD |
| R1-2 | fixed | `server/core/logging/tests/metrics.test.ts:100` writes 3 grouped `security` lines, checks that `ogw_log_lines_total{kind=security,level=warn}` is 1, advances the clock by 2 × `logging.securityRepeatWindowMs`, checks that the `repeated` summary line was written and that the count is 2. Removed `metrics.line(now, 'security', 'warn', null)` (`server/core/logging/index.ts:230`) in a `git worktree add` copy of HEAD and ran `ogw core test server logging --file server/core/logging/tests/metrics.test.ts`: this test failed on sqlite and on postgresql with `expected 1 to be 2` |

## out of scope

- server/core/logging/metrics.ts:160: medium `#slot` prunes at the time of each line written, so after a line at a later test clock time, a judgement or line at an earlier time after `set_time` moved the clock back no longer counts the lines dropped at that later time. `### alert signal` sets no upper bound on the window and does not say what happens when the clock goes back. The behaviour existed before this range, where the old `#slot` also pruned at each line. The spec needs to say what a judgement counts after the clock went back, or the implementation has to keep every line

## debt

none

## must fix

none

## unknown

- Of the core tests, only `server/core/logging/tests/metrics.test.ts` (on the copy with line 230 removed) and `server/core/logging/tests/metrics-window.test.ts` (on the copy with the old `metrics.ts`, and on HEAD) were run, each with `ogw core test server logging --file`. The rest of the logging suite and the modules that depend on logging were not run in this review
- The real-time bound of `metrics-window.test.ts:135` (300 ms) was judged only on this host. HEAD stays far below it, and the restored defect takes about 900 ms. Not run on a slower host
- The other commits of the range (p2p-signaling and other modules) change nothing under `server/core/logging/` and were not reviewed
