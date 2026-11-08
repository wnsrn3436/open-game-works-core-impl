# review logging round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | test evidence | medium | server/core/logging/tests/metrics-window.test.ts:87 | Its doc comment says `judgement_time` gives a time at or after `latest_line`, but its second branch gives `latest_line + floor(random() × (latest_judged − latest_line + 1))`. Lines move `latest_line` forward without moving `latest_judged`, so `latest_judged < latest_line` is common. The factor is then negative and the judgement falls below `latest_line`. With seed 7 (`:111`) this happens 8 times in the 300 judgements, as much as 15 ms below. For such a judgement, `counts_of` (`:130`) counts every line written later than judgement − window. But `Metrics.line` already dropped the slots at or before (latest line time − window) (`#slot` → `#prune`, `server/core/logging/metrics.ts:160`; this is the open debt D1 of `records/review-debt/logging.json`). So the expected signals and the judged signals differ whenever such a line changes a signal. The test passes only because of seed 7. Ran the same generator and comparison against `server/core/logging/metrics.ts` of HEAD (`node --experimental-strip-types`, same settings grid and `random_line`/`judgement_time` call order) for seeds 1 to 200: 126 seeds have at least one judgement where `alerts` differs from `expected_alerts`. Every mismatch was at a judgement below `latest_line` (0 mismatches at or after it). With the second branch clamped to `latest_line`, all 200 seeds pass. So a reseed or a small change of the call order makes the test fail with no defect in `alerts`, and the test checks a behaviour that `Metrics` does not have | Keep the judgement at or after `latest_line`, as the doc comment says: draw from `[latest_line, max(latest_judged, latest_line)]`. Then `judged_back` still counts judgements below `latest_judged` | no | 95 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | `Metrics.alerts` (`server/core/logging/metrics.ts:212-221`) no longer calls `#prune`. It subtracts the slots from `#head` at or before its cutoff from a copy of `#totals` and leaves `#head` and `#slots` as they are, so a later judgement at an earlier time still counts them. Per the report, `server/core/logging/tests/metrics-window.test.ts:144` repeats the round-2 reproduction (`alerts(1050)` true, `alerts(2000)` false, `alerts(1050)` true, plus the boundaries 1100 true and 1101 false), and `server/core/logging/tests/metrics.test.ts:255` covers it through `write`/`read_metrics` with the test clock moved back. On HEAD, `ogw core test server logging --file server/core/logging/tests/metrics-window.test.ts` and `... --file server/core/logging/tests/metrics.test.ts` both passed on sqlite and postgresql |

## out of scope

none

## debt

none

## must fix

none

## unknown

- `records/review-debt/logging.json` holds D1, the round-2 out-of-scope item on `#slot` pruning at each line's time (`server/core/logging/metrics.ts:160`). The input `## debt` is `none`, so D1 is not judged here and is not written again in `## out of scope`. R3-1 shows that D1 is still there: lines dropped by a later line are not counted by a judgement whose cutoff is earlier
- Only `server/core/logging/tests/metrics-window.test.ts` and `server/core/logging/tests/metrics.test.ts` were run, on HEAD, with `ogw core test server logging --file`. The rest of the logging suite and the modules that depend on logging were not run. The report says the full `ogw core test server` over `logging` and its 36 dependents passed
- The R2-1 tests were not checked against a restored defect, since R2-1 is a `spec` finding and not a `test evidence` finding. The report says all three failed with the old `metrics.ts`
- Because `alerts` no longer drops slots, every `read_metrics` while no line is written walks the slots at or before its cutoff again. That is at most the distinct `clock_now` values of one `logging.alertWindowMs`, and the next line drops them. This was not measured, and it is not written as a finding
- The 300 ms real-time bound of `metrics-window.test.ts` "writes a line at a cost that does not grow with the lines in the window" was judged only on this host
- The other commits of the range (iap, rating, routing, testing, BootstrapCore and other review records) change nothing under `server/core/logging/` and were not reviewed
