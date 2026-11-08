# review logging round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/logging/metrics.ts:160 | Input debt D1, still open. `### alert signal` of the logging spec (`open-game-works-core/skills/server-core/modules/logging.md:205`) sets the alert window as the lines `write` wrote at a `clock_now` later than the judgement time − `logging.alertWindowMs`, with no upper bound and nothing about the clock going back. `Metrics.line` calls `#slot(now)`, which first calls `#prune(now)` (`metrics.ts:187-205`) and drops for good every slot at or before `now` − window. The `alerts` doc comment (`metrics.ts:207-211`) says only a judgement keeps them, "The next line drops them". Reproduced with a temporary vitest test on `Metrics` alone (window 100, `alert_error_log_count` 2): `line(1001, 'error', 'error')`, then `alerts(1050).error_logs` is `false` (as expected, 1 line), then `line(2000, 'error', 'error')`, then `alerts(1050).error_logs` is `false`. The spec counts both lines (1001 > 950 and 2000 > 950), so it should be `true`. Through the server this happens when `testing` `set_clock` moves the test clock forward, a line is written, and `set_clock` moves it back before `read_metrics`. `server/core/logging/tests/metrics-window.test.ts:80-89` only judges at or after the latest line time, so the suite never reaches this case | Change the spec so it says what a judgement counts after the test clock went back past lines that a later line dropped (e.g. the window counts only lines not yet dropped by a line at a later `clock_now`, or the window is bounded by the latest line time), and test that sentence. The other way, keeping every line written so that an earlier judgement can count them, makes memory grow with every line for the whole server run | yes | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `#slot` still calls `#prune(now)` on each line (`server/core/logging/metrics.ts:160`), and the spec text of `### alert signal` (`logging.md:205`) has not changed (last change f3d27fc, before this range). Reproduced as written in R1-1 |

## must fix

none

## unknown

- The commit range 625ae189..625ae189 is empty, so no changed code was reviewed; this round checked only debt D1
- Only `server/core/logging/metrics.ts` and `server/core/logging/tests/metrics-window.test.ts` were read for D1. The other logging code and tests were not reviewed again in this round
- The R1-1 reproduction called `Metrics` directly in a temporary test file (removed afterwards). It did not go through `testing` `set_clock` and `read_metrics` on a running server instance
