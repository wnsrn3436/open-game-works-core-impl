# review rating round 1

## findings

none. The range changes no file of `server/core/rating/` or of its dependency modules. Its only reach to `rating` is `mailbox.defaultExpireMs` minimum 1 and `server/core/routing/tests/settings-minimum.test.ts`. `rating` sends `expire_ms` 0 and `no_expiry` `false` (`server/core/rating/index.ts:220`), which still takes `mailbox.defaultExpireMs`, and that test leaves `mailbox.maxAttachments` at its default, so the start check of `rating_tier` still passes

## previous

none

## out of scope

- server/core/rating/index.ts:192: medium `spec` A row whose rule has `season_board` `null` and whose `season` is not 0 is settled, while `rating` `## data` says a `null` board has a single season 0 and no settle, and `## test` says such a rule has no settle. `stored.season === season` is the only guard, so a game data change from a board to `null` soft resets the rating and zeroes `season_games` of every row with a past season. Reproduced in a temporary copy: `put_core_state` of a `[rating_rule_seasonless]` row with `season` 5 and `season_games` 3, then `get_rating` gives `season` 0 and `season_games` 0, and `RefreshRating` writes that row
- server/core/rating/index.ts:195: medium `test evidence` No core test goes through the `rating` `## error` row "failure of `validation.apply_permille` in step 2 of season settle". In a temporary copy, removing the `!scaled.success` throw left all 28 `rating` tests passing. Same problem as D3 of `records/review-debt/rating.json`
- server/core/rating/index.ts:197: medium `test evidence` No core test reaches the clamp of step 2 of `### season settle` ("When it is less than `min_rating`, it is `min_rating`"). In a temporary copy, changing line 197 to `row.rating = reset` left all 28 `rating` tests passing. The `soft_reset` helper of `server/core/rating/tests/season.test.ts:32` also calculates the clamp itself, and no test input reaches it. Reproducing input for the missing test: `set_rating` of -3000 on `[rating_rule_basic]` (`min_rating` 0, `soft_reset_target` 1000, `soft_reset_permille` 500), advance the season, then `RefreshRating`; the row must be 0. That input passes on the current code
- server/core/rating/index.ts:212: medium `test evidence` No core test settles a row of tier 0 on a rule with rewards, so the rule that a past season without a tier sends no reward has no test. In a temporary copy, removing `settled.tier_id === 0` left all 28 `rating` tests passing, although `RatingTierTable.get_row(0)` is then called for such a row. Reproducing input for the missing test: `set_rating` of -3000 on `[rating_rule_basic]`, advance the season, then `RefreshRating`; the response must succeed and no mail is sent. That input passes on the current code
- server/core/rating/index.ts:224: medium `test evidence` No core test goes through the `ALREADY_SENT` counts as success rule of `### season settle`. In a temporary copy, accepting only `OK` left all 28 `rating` tests passing. Same problem as D1 of `records/review-debt/rating.json`
- server/core/rating/index.ts:225: medium `test evidence` No core test goes through the `rating` `## error` row "`INVALID_INPUT` from season reward `send_mail`". In a temporary copy, returning instead of throwing left all 28 `rating` tests passing. Same problem as D2 of `records/review-debt/rating.json`

## debt

none

## must fix

none

## unknown

- The `rating` tests ran only with `OGW_DEFAULT_DB` `sqlite`, on a temporary copy of the target commit with `server/build/data` copied from the main checkout of `open-game-works-core-impl/`. The PostgreSQL run was not done, so behavior specific to PostgreSQL is not checked
- `server/core/mailbox/`, `server/core/ranking/`, `server/core/storage/`, `server/core/validation/` and `server/core/logging/` were read only where `rating` calls them. Their own behavior belongs to their own reviews
- `server/core/matchmaker/` was read only at its `rating` references. The apply-once guarantee that `### match outcome` relies on is not checked here
- Client core use of `RatingUserState` and `RefreshRating` (`client/godot/`) was not read, because it is not part of this server module
- `records/review-debt/rating.json` has D1 to D3 at `server/core/rating/index.ts:224`, `:225` and `:195`, but input `## debt` is `none`, so they have no `## debt` row here. The lines above use those same locations, so the review lists do not add them again
