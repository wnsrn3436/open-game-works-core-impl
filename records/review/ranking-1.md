# review: ranking round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/ranking/reward.ts:311 | At the end of reward retry, `reward_retry` calls `finish_pass` (server/core/ranking/store.ts:371) and does not check `is_stopped` first. The only stop checks are inside the loop, after a due row is handled (reward.ts:293, reward.ts:308). So when `due` is empty, or when a stop begins after the last loop check, nothing blocks the transition. `finish_pass` then sets `status` to `Closed` when no retry rows are left, or to `Retrying` with `lease_until_at = 0` (store.ts:372-374). open-game-works-core/skills/server-core/modules/ranking.md:174 says that once `stop()` has started, the `Closed` and `Retrying` transitions at the end of reward retry are not done. Run path: a `Retrying` season with one retry row whose `next_attempt_at` is in the future and whose lease has ended. `ranking_season` runs, and `stop()` begins inside the `take_lease` transaction (the same `storage.db` wrap as server/core/ranking/tests/reward.test.ts:362). Then `read_due_retries` returns nothing, and `finish_pass` writes `lease_until_at` 0 after the stop. If no retry rows remain (e.g. `remove_user` deleted the last one), the same path closes the season instead. `close_pass` has this check (reward.ts:275, tested by reward.test.ts:362). Reward retry has no test for this path: the stop tests in reward.test.ts:314-430 cover a FAILED handled row and the first pass only | Before the `finish_pass` call at reward.ts:311, add `if (is_stopped(core)) return;`, as `close_pass` does at reward.ts:275. Add a test like reward.test.ts:362 for a `Retrying` season with no due row, for both the remaining-rows case and the no-rows case, asserting that `status` and `lease_until_at` are unchanged and that the next holder finishes the season | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | server/core/ranking/reward.ts:311 at HEAD f8ed28b still calls `finish_pass` with no `is_stopped` check after the loop (reward.ts:289-310). No test in server/core/ranking/tests/reward.test.ts covers a stop before the end of reward retry when no due row stops it |

## must fix

none

## unknown

- The commit range f8ed28b..f8ed28b is empty, so the only review target is debt item D1. I did not review the rest of the ranking module for new findings in this round
- R1-1 is confirmed by reading the code: `finish_pass` and `close_season` in store.ts, the loop's stop checks in reward.ts, and the stop tests in reward.test.ts. I did not run the reproduction again in a temporary copy. The run path is the one recorded in input D1
- Not checked against the spec: in `reward_retry`, when the board is missing from data, `close_season` runs with no stop check (reward.ts:283-285). ranking.md does not define what happens when the board of a `Retrying` season is missing, and this code is outside the empty commit range
