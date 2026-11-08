# review rating round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | The test `takes as the forfeiter of a FORFEIT match only a participant that left without a report: not one that reported and then left, nor one that neither reported nor left` (server/core/rating/tests/match-outcome.test.ts:218) is a 3-participant `FORFEIT` match of `team_size` 0, with index 0 `{reported_at: 1000, left_at: 2000}`, index 1 `{reported_at: 0, left_at: 1000}` and index 2 `{reported_at: 0, left_at: 0}`, with ratings 1500, 1500, 1700 and K 20. Its expected Δ values match step 3-5 of `### match outcome` (open-game-works-core/skills/server-core/modules/rating.md:83-85). For index 0, m 1 and Σ 500 give floor_div(21000, 2000) = 10. For index 1, m 2 and Σ −740 give floor_div(−27600, 4000) = −7. For index 2, m 1 and Σ 240 give floor_div(10600, 2000) = 5. The defect was restored in two temporary `git worktree add --detach` copies of HEAD by changing line 158 of server/core/rating/index.ts. With `return p !== undefined && p.reported_at === 0n;`, `ogw core test server rating --file match-outcome.test.ts` fails this test with `expected 13n to be 10n` on both SQLite and PostgreSQL. With `return p !== undefined && p.left_at !== 0n;`, it fails with `expected -5n to be 10n` on both SQLite and PostgreSQL. `ogw core test server rating` passes on the unchanged HEAD |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range changes nothing under server/core/rating other than server/core/rating/tests/match-outcome.test.ts. The other changes in the range (iap, logging, routing, storage, testing, client) belong to other review targets and were not reviewed. Rating calls storage and logging, but the storage change (server/core/storage/db/sqlite.ts, SQLite open and WAL statements under the meter) and the logging change (server/core/logging/metrics.ts, alert window) do not touch an API that rating calls. They were checked only through the rating tests passing
- The two round-1 out-of-scope problems (matchmaker `MatchRecordInput` has no `status`, and matchmaker has no `FORFEIT` judgement or `apply_match_forfeit`) are still in the code (`grep -il forfeit server/core/matchmaker/*.ts` finds only results.ts, and server/core/matchmaker/records.ts:39 is the match row `status`, not the record input). They are already listed as matchmaker must-fix M1 and debt D3, so they are not written again here
- The core tests of the modules that depend on `rating` were not run, because `ogw review run` runs them
