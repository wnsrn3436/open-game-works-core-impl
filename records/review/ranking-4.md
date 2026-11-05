# review: ranking round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | server/core/ranking/reward.ts:77 `item_amount` now returns null unless `big_amount` is a `string`, and reward.ts:85-92 `is_int32` / `reward_of` require `extra_id` to be an integer `number` from −2^31 to 2^31 − 1. This matches ranking.md:164 (the hook output format of step 1). A wrong format makes `season_reward` throw (reward.ts:109), so `reward_user` gives `FAILED` (reward.ts:148-149), which puts in a retry row. server/core/ranking/tests/reward.test.ts:241-256 covers an `Error` throw, a string throw, an attachment without `big_amount`, and `extra_id` 2^31, −2^31 − 1 and 0.5. It checks the retry row, `Retrying`, `failed_count` 0 and the log. Both of the round 3 reproductions are in it: (a) without `big_amount` the old code sent 1 mail, but the test expects 0 mails; (b) with `extra_id` 2^31 the old code was `REJECTED` with no retry row, but the test expects a retry row. reward.test.ts:258-263 checks that the bounds −2^31 and 2^31 − 1 are sent. `ogw core test server ranking` passes |
| R3-2 | fixed | server/core/ranking/reward.ts:188-195 `game_tx` now takes the board ID and season. On `FAILED` it leaves the `error` log `season game transaction failed` with `board_id` and `season` through `report`, which leaves no log after `stop()` (reward.ts:161-163). This matches ranking.md:175 and the error table at ranking.md:203. Every caller passes its season, and each still stops that season the same way as before: lease take reward.ts:332, guild member read 244, member write 204, cursor write 215, retry write 309, close 270/296, finish 288/325. Retention reward.ts:344 still goes to the next season (step 6). Tests: reward.test.ts:265-282 (the first `run_game_transaction` returns `FAILED`; it checks one log for that season and that the season stays `Open`; the next run closes it) and reward.test.ts:284-310 (PostgreSQL `hold_db` on the `ranking_season` row). The old code had no log, so it fails the log assertion of both tests |
| R3-3 | fixed | server/core/ranking/dev/index.ts:33-40 wraps the `after_commit` body (the `read_season` on `read_db` and `close_pass`) in try/catch. It logs `close_season_now reward: <message>` with `board_id` and `season` through `report`, as ranking.md:175 and :204 require for the reward handling of `close_season_now`. `FAILED` game transactions in that handling are logged by `game_tx` (R3-2). Test: server/core/ranking/tests/dev.test.ts:74-102 (every cursor write throws `Error('boom')`; it checks exactly one `error` log, `Closing` at cursor 0, and that the job after the lease ends closes it with one mail). Before the fix, `after_commit` dropped the throw, so that log was missing |

## out of scope

none

## debt

none

## must fix

none

## unknown

- `ogw core test server ranking` ran once in this checkout and passed. I did not run the modules that depend on ranking, and I did not restore the round 3 defects in a temporary copy: R3-1, R3-2 and R3-3 are `spec` findings, not `test evidence` findings. For each one I checked by reading the test that its assertions fail on the old code
- `## spec changes` removes two things from ranking.md: the sentence in `## behavior` that said a failure after `stop()` leaves no `error` log, and the `## test` item for the PostgreSQL `close_season_now` step 4 `FAILED` case. The error table (ranking.md:201-204) and server-time.md:93 still say there is no `error` log after `stop()`, and `report` (reward.ts:161) follows them, so the code does not differ from the changed definitions. The test at server/core/ranking/tests/dev.test.ts:105 still exists and now matches no `## test` item. An extra test is not a spec difference, so it is not a finding
- For the storage, mailbox, item-ledger, logging, core SKILL and core command changes in that diff, I checked only the parts that ranking calls. That is the TypeScript `send_mail` input types: the int32 `extra_id` is now enforced by `reward_of`, `expire_ms` is a `bigint`, and integer `MailArg`s have no `kind`. I also checked the order of `ALREADY_SENT` after `INVALID_INPUT`, a throw or `FAILED` of a statement inside `run_game_transaction` and `run_user_transaction` (ranking's game transaction functions catch nothing, so a throw reaches the catch in `run_season_job` or in the `close_season_now` handling), and `read_db` statement failures. I found no difference
- The round 2 `## unknown` item is still not judged: in `close_pass` and `reward_retry`, `close_season` for a missing board or `reward_mail` 0 has no stop check (reward.ts:269-271, 295-297). ranking.md:174 limits the stop rule to the `Closed` and `Retrying` transitions of step 5 and of the end of reward retry, and does not say whether the step 3 close is also covered
