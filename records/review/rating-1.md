# review rating round 1

## findings

none

## previous

none

## out of scope

- server/core/rating/index.ts:224: medium `test evidence` No core test goes through the `ALREADY_SENT` counts as success rule of `rating` `### season settle`. `server/core/rating/tests/` has no `ALREADY_SENT` case, and every test mail there is the first send of its `once_key`. In a temporary copy, line 224 was changed to accept only `OK` and `ALREADY_SENT` was made to throw; all 28 `rating` tests still passed. Reproducing input for the missing test: send a mail with `once_key` `rating:<rule ID value>:<past season>` first, advance the season with `ranking.close_season_now`, then send `RefreshRating`. It must succeed and write the settled row. This path was not changed in the range
- server/core/rating/index.ts:225: medium `test evidence` No core test goes through the row of `rating` `## error` "`INVALID_INPUT` from season reward `send_mail` | throw | `INTERNAL`". In the same temporary copy, `INVALID_INPUT` was made to return without a throw, so settle is written and the reward is lost; all 28 `rating` tests still passed. Reproducing path for the missing test: make `mailbox.send_mail` return `INVALID_INPUT` during `RefreshRating` after a season change. The response must be `INTERNAL` and the row must stay unsettled. This path was not changed in the range
- server/core/rating/index.ts:195: medium `test evidence` No core test goes through the row of `rating` `## error` "failure of `validation.apply_permille` in step 2 of season settle | throw | `INTERNAL`". In the same temporary copy, the `!scaled.success` throw was removed, so settle uses a scaled value of 0; all 28 `rating` tests still passed. Reproducing input for the missing test: `set_rating` of 2^60 on `[rating_rule_basic]`, advance the season, then `RefreshRating`. `value × permille` is then outside int64, and the response must be `INTERNAL` with the row unchanged. This path was not changed in the range

## debt

none

## must fix

none

## unknown

- The commit range changes no file in `server/core/rating/` and no line of `rating.md`. The changes read for their effect on `rating` were `core-spec/matchmaker.json`, `core-spec/ranking.json`, `core-spec/validation.json`, `core-spec/routing.json`, `server/core/matchmaker/realtime.ts`, `server/core/matchmaker/shared.ts`, `server/core/testing/dev/setting_types.ts`, `settings/core-settings.json` and `tools/data-tool/src/corespec.ts`. None of them touches an operation, table, setting or field that `rating` reads
- `rating` tests ran only with `OGW_DEFAULT_DB` `sqlite`, by running vitest directly in a temporary copy. The PostgreSQL run was not done
- The temporary copy used the existing `server/build/data` of the main checkout of `open-game-works-core-impl/`. That data was not rebuilt with the data tool of this commit
- `ogw core test`, `ogw code check` and the data tool tests in `tools/data-tool/tests/check-rating.test.ts` were not run. `tools/data-tool/src/checks/rating.ts` was read against `rating` `## data`, and no difference was found
- `apply_match_outcome` called inside `matchmaker.apply_match_mismatch` was not run. The `rating` tests cover only `apply_match_result`, and `rating` `## test` requires only that hook
- The three `test evidence` lines were checked by one run with all three changes applied together, not by one run per change
