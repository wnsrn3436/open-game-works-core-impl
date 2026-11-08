# review logging round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `judgement_time` (`server/core/logging/tests/metrics-window.test.ts:85-90`) now draws its second branch from `[latest_line, max(latest_judged, latest_line)]`, and `:127` asserts each judgement is at or after `latest_line`. Every slot that `Metrics.line` drops is at or before (a line time − window) ≤ (`latest_line` − window) ≤ (judgement − window), so a judgement no longer falls where D1 pruning makes `alerts` and `counts_of` differ. Checked in a temporary `git worktree add` of HEAD with the randomized test changed to `it.each` over seeds 1 to 200 (`random_of(seed)`): with the clamped generator, `ogw core test server logging --file server/core/logging/tests/metrics-window.test.ts` passed every seed on sqlite and postgresql; with the old generator restored (the unclamped `latest_judged - latest_line + 1n` and the `:127` assert removed), the same run failed on many seeds (e.g. 152, 156, 157, 200) with `alerts` differing from `expected_alerts`. The committed seed-7 test still fails on a restored alert defect: with `this.#prune(now)` put back at the start of `Metrics.alerts` (`server/core/logging/metrics.ts:212`, the R2-1 defect), the randomized test and the R2-1 test both failed on sqlite and postgresql. On unchanged HEAD, `metrics-window.test.ts` and `metrics.test.ts` passed on sqlite and postgresql |

## out of scope

none

## debt

none

## must fix

none

## unknown

- `records/review-debt/logging.json` D1 (`#slot` pruning at each line's time, `server/core/logging/metrics.ts:160`) is not in the input `## debt`, so it is not judged here and not written again in `## out of scope`. The randomized test no longer makes judgements below `latest_line`, so it neither shows nor checks D1
- Only `server/core/logging/tests/metrics-window.test.ts` and `server/core/logging/tests/metrics.test.ts` were run, with `ogw core test server logging --file`. The rest of the logging suite and the modules that depend on logging were not run, as the range changes only a test file under `server/core/logging/`
- The 300 ms real-time bound of `metrics-window.test.ts` "writes a line at a cost that does not grow with the lines in the window" was judged only on this host
- The other commits of the range (routing, testing and review records of iap, routing, testing) change nothing under `server/core/logging/` and were not reviewed
