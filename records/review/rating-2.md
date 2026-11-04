# review rating round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | New test `server/core/rating/tests/season.test.ts:266` sends the `once_key` `rating:<rule>:<past season>` mail first, closes the season, and expects `RefreshRating` to succeed with the row settled and no second mail. Restored in a temporary copy: `server/core/rating/index.ts:225` changed to `if (sent.result === 'OK') return;` so `ALREADY_SENT` throws. `ogw core test server rating --file server/core/rating/tests/season.test.ts`: that test failed on SQLite and PostgreSQL (`expected 8 to be +0`, the `INTERNAL` code from `refresh_code`) |
| R1-2 | fixed | New test `season.test.ts:298` starts with `mailbox.maxArgs` 0, so the real `send_mail` returns `INVALID_INPUT` for the one `season` arg. It expects `CORE_ERROR_INTERNAL`, the row unchanged and no mail. Restored in a temporary copy: `index.ts:225` also returns on `INVALID_INPUT`. That test failed on both DBs (`expected +0 to be 8`) |
| R1-3 | fixed | New test `season.test.ts:315` uses `set_rating` 2^60 on `[rating_rule_basic]`, closes the season, and expects `CORE_ERROR_INTERNAL` with the row unchanged and no mail. Restored in a temporary copy: the `!scaled.success` throw at `index.ts:196` deleted, so settle uses the failure value `0n` of `server/core/validation/integer.ts:34`. That test failed on both DBs (`expected +0 to be 8`) |
| R1-4 | fixed | `index.ts:193` returns no settle when `rule.season_board === 0`, whatever the stored `season`. New test `season.test.ts:243` writes a `[rating_rule_seasonless]` row with `season` 5 and `season_games` 3, and checks `get_rating` keeps `season_games` 3 and `RefreshRating` leaves the row. Restored in a temporary copy: `rule.season_board === 0 \|\|` removed from line 193. That test failed on both DBs (`get_rating` result did not match `season_games: 3`) |
| R1-5 | fixed | New test `season.test.ts:330` uses `set_rating` −3000 on `[rating_rule_basic]` and checks the literal `0n` after settle, without the `soft_reset` helper. Restored in a temporary copy: `index.ts:198` changed to `row.rating = reset;`. That test (and the tier 0 test at line 343) failed on both DBs |
| R1-6 | fixed | New test `season.test.ts:343` settles a row of tier 0 with `season_games` 2 (= `reward_min_games` of `test-data/data/tables/rating_rule.csv:5`) and expects success and no mail. Removing only `settled.tier_id === 0 \|\|` from `index.ts:213` does not change behavior: `RatingTierTable.get_row(0)` returns `RatingTierRow_EMPTY` (`server/generated/data/game_data.ts:1985-1987`), whose empty `season_reward` returns at line 215, and the test passed on that copy. So the defect was restored as a reward sent for a past season without a tier: in a temporary copy `index.ts:194` took the past tier of `max(stored.rating, min_rating)`, which mails the `[rating_tier_bronze]` reward. That test failed on both DBs (`expected [ MailUserState{...} ] to deeply equal []`) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: `season.test.ts:266` reaches the `ALREADY_SENT` branch of `index.ts:225` and fails when that branch throws |
| D2 | fixed | none | Same as R1-2: `season.test.ts:298` goes through the `INVALID_INPUT` row of `## error` and fails when `INVALID_INPUT` returns without a throw |
| D3 | fixed | none | Same as R1-3: `season.test.ts:315` goes through the `apply_permille` failure and fails when the throw at `index.ts:196` is removed |
| D4 | fixed | none | Same as R1-4: `index.ts:193` skips settle for a `null` `season_board`, and `season.test.ts:243` fails on the code without that guard |
| D5 | fixed | none | Same as R1-5: `season.test.ts:330` reaches the clamp and checks a literal, and fails when the clamp at `index.ts:198` is removed |
| D6 | fixed | none | Same as R1-6: `season.test.ts:343` settles a tier 0 row on a rule with rewards and fails when such a past season sends a reward |

## must fix

none

## unknown

- I read the range changes of `server/core/rating/` (`index.ts`, `tests/helpers.ts`, `tests/season.test.ts`) and the only other change in a module `rating` depends on, `server/core/ranking/reward.ts:311` (an `is_stopped` return in season reward retry). `rating` reads only `ranking.get_season`, so that change does not reach `rating`. No other dependency module of `rating` changed in the range
- Mutation runs used `ogw core test server rating --file server/core/rating/tests/season.test.ts` only, in copies of this checkout's HEAD placed under `worktrees/_core/` (the tool runs the main checkout for any other cwd) and deleted afterwards. The unmutated copy passed. I did not run the other `rating` test files or the dependent modules on the mutations
- The core agent report says that without the `tier_id === 0` guard `RatingTierTable.get_row(0)` would throw; it does not (it returns the empty row), so that guard has no observable effect. This is not a finding: behavior equals the spec
