# review rating round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/rating/tests/helpers.ts:152 | `judged` makes only two participant shapes: a forfeiter `{reported_at: 0, left_at: 1000}` and a non-forfeiter `{reported_at: 1000, left_at: 0}`. So no `FORFEIT` test tells apart the two conditions of `is_forfeiter` (server/core/rating/index.ts:158, `left_at` not 0 and `reported_at` 0, the forfeiter of `### result decision` of open-game-works-core/skills/server-core/modules/matchmaker.md:197). Checked in a temporary `git worktree` of HEAD with `ogw core test server rating`: with line 158 changed to `p !== undefined && p.reported_at === 0n` (no `left_at` check) all rating tests pass, and with it changed to `p !== undefined && p.left_at !== 0n` (no `reported_at` check) all rating tests pass too. Both shapes come up in normal `FORFEIT` matches: a participant that reported and then did `MATCH_LEAVE` with `forfeit` `true` is not a forfeiter (open-game-works-core/skills/server-core/modules/matchmaker.md:422), and in a 3-participant final decision a participant that neither reported nor left (`Missing`, open-game-works-core/skills/server-core/modules/matchmaker.md:222) is not a forfeiter. With either mutation that participant is counted as a forfeiter: it gets S = 0 against the real forfeiter's opponents instead of 1000 against the forfeiter, so its Δ has the wrong sign | Add `FORFEIT` cases in which a non-forfeiter has `reported_at` ≠ 0 and `left_at` ≠ 0, and in which a non-forfeiter has `reported_at` 0 and `left_at` 0 (e.g. a 3-participant `team_size` 0 match: index 0 reported, index 1 left without a report, index 2 neither), and check each participant's Δ and m | no | 92 |

## previous

none

## out of scope

- server/core/matchmaker/records.ts:60: high `MatchRecordInput`, the match record input that the apply hooks get, has no `status` (and `record_input` at server/core/matchmaker/records.ts:356 sets none). open-game-works-core/skills/server-core/modules/matchmaker.md:273-274 defines `status` in the match record input, and open-game-works-core/skills/server-core/modules/rating.md `## API` reads `status` from it. Content code that does what open-game-works-core/skills/server-core/modules/rating.md says (calls `rating.apply_match_outcome` inside `matchmaker.apply_match_result` with the received record) fails the type check, because `rating.MatchRecord.status` is required. At runtime it gets `status` `undefined`, `is_valid_input` (server/core/rating/index.ts:287-294) returns false, and every apply gives `INVALID_INPUT` with an `error` log and no rating change. The rating integration test hides this with `status: record.status ?? MATCH_JUDGE_STATUS_CONFIRMED` (server/core/rating/tests/matchmaker.test.ts:15)
- server/core/matchmaker/shared.ts:136: medium matchmaker has no `FORFEIT` judgement and no `apply_match_forfeit` hook (`decide` in server/core/matchmaker/judge.ts returns only `CONFIRMED` or `MISMATCH`; `apply_in` in server/core/matchmaker/results.ts:143-152 calls only `apply_match_result` or `apply_match_mismatch`; `grep -i forfeit server/core/matchmaker/*.ts` finds only a comment). open-game-works-core/skills/server-core/modules/matchmaker.md:208-209 and :215 define them, so the `FORFEIT` path of `rating.apply_match_outcome` (open-game-works-core/skills/server-core/modules/rating.md `### match outcome` steps 3-4) cannot be reached from matchmaker, and no match is judged `FORFEIT`

## debt

none

## must fix

none

## unknown

- `ogw core test server rating` passes on HEAD. The core tests of the modules that depend on `rating` were not run, as `ogw review run` runs them
- The PostgreSQL runs of the rating tests were not checked separately; the run used the default test setup of `ogw core test`
- The matchmaker-side behavior was read only as far as it gives `rating` its input (`records.ts`, `shared.ts`, `results.ts`, `judge.ts`). The rest of matchmaker was not reviewed, as it is outside the target
