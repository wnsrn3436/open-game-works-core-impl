# update core: rating

## done

- `server/core/rating/index.ts` (commit e2366679)
  - `RatingResult.VOID`. `apply_match_outcome` of a match record whose `status` is `MISMATCH` returns `VOID`, writes nothing and leaves no log. Order of step 1: `INVALID_INPUT`, then `NO_RATING`, then `VOID`
  - `MatchRecord` of `rating` now reads `status` (`MatchJudgeStatus`) and `participants` (`reported_at`, `left_at`) besides `mode_id`, `user_ids`, `ratings`, `teams`. It is a structural type (`Pick` of `matchmaker` `MatchRecordInput` for the old fields plus the two new ones), because `MatchRecordInput` of `matchmaker` on main has no `status` yet
  - `INVALID_INPUT` conditions: `CONFIRMED` with a rank count different from the participant count, `FORFEIT` with a non-empty rank list, `PENDING` (and any status that is not `CONFIRMED`, `FORFEIT` or `MISMATCH`), plus the old index, user and negative rank conditions. The `error` log of `INVALID_INPUT` also carries `status`
  - `FORFEIT`: forfeiter = `left_at` ≠ 0 and `reported_at` = 0. Opponents keep only those of known outcome (a forfeiter's non-forfeiter opponents; another participant's forfeiter opponents). S is 0 for a forfeiter and 1000 for another participant. m = 0 changes no rating and still counts the match
  - opponent selection and S were moved into module functions `is_forfeiter`, `opponents_of`, `score_of` (lint complexity)
- Tests (`server/core/rating/tests/match-outcome.test.ts`, helper `judged` in `helpers.ts`)
  - MISMATCH: `VOID` for both participants with a full and an empty rank list, no row change, no log line
  - 1v1 FORFEIT of equal ratings with the empty rank list: non-forfeiter Δ = `floor_div`(2K×500 + 1000, 2000), forfeiter Δ = `floor_div`(−2K×500 + 1000, 2000) (forfeiter at index 0, so rank order is not used)
  - 3-participant FORFEIT, `team_size` 0, one forfeiter: m = 2 for the forfeiter, m = 1 for each other (Δ 10, not the 5 that m = 2 would give)
  - FORFEIT with `team_size` 2: the forfeiter's teammate has m = 0 (rating unchanged, counts +1), the forfeiter m = 2, an opponent m = 1
  - `INVALID_INPUT` additions: `CONFIRMED` with the empty list, `FORFEIT` with a non-empty list, `PENDING` with a full and an empty list, `MISMATCH` with a negative rank
- `ogw core test server rating`: pass. `ogw core test server matchmaker rating routing testing` (the server modules of `ogw core dependents rating`): pass. `ogw code check core`: type check, lint, dependency and secret pass
- No engine-specific implementation rules document or `## <engine> build` was written
- Other modules' code: not changed. `server/core/rating/tests/matchmaker.test.ts` (rating's own test through the `matchmaker` hook `apply_match_result`) passes `record.status ?? CONFIRMED` to `apply_match_outcome`, because the `matchmaker` on main does not put `status` in the hook input yet. When the `matchmaker` update adds `status` and `participants.ended_at` to `MatchRecordInput`, `rating.MatchRecord` stays assignable from it; the `matchmaker` agent can then remove the `??` fallback and the `MatchHookRecord` type in `rating/tests/helpers.ts`, and content code passes the hook record as is

## spec proposals

- `INVALID_INPUT` of `RatingResult` names `PENDING` but not `MatchJudgeStatus` `UNSPECIFIED` (0) or a value outside the enum. The implementation treats every status other than `CONFIRMED`, `FORFEIT` and `MISMATCH` as `INVALID_INPUT`. Proposal: write "or `status` is not `CONFIRMED`, `FORFEIT` or `MISMATCH`" in place of "or `status` is `PENDING`"
- In a `MISMATCH` match the rank list is not checked for its length (any length, or empty, gives `VOID`), but a negative rank is still `INVALID_INPUT` because the `INVALID_INPUT` conditions are checked before `VOID`. The spec text gives this order; proposal: state it in `## test` so that content code that passes its MISMATCH ranks knows a negative rank is an error and not `VOID`

## review

none

## unverified

- The `matchmaker` hooks with a real `FORFEIT` or `MISMATCH` judgement calling `apply_match_outcome` were not tested end to end: `matchmaker` on main has no `FORFEIT` judgement, no `apply_match_forfeit` hook and no `status` in the hook input. The rating side was tested with match records made in the test
- Client modules listed by `ogw core dependents rating` (BootstrapCore, QACore, RealtimeCore, UnitTestCore) were not run: the input sets the range to `ogw core test server`, and no client or contract file changed
