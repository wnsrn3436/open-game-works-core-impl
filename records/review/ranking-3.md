# review: ranking round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | server/core/ranking/reward.ts:71 | open-game-works-core/skills/server-core/modules/ranking.md:164 now says the hook output format is right only when each attachment's `big_amount` is a `string` and `extra_id` is an integer `number` from −2^31 to 2^31 − 1. A wrong format must make the change function throw, so the handling is `FAILED` (ranking.md:319). In the code, `item_amount` (reward.ts:78) accepts an attachment with no `big_amount` and sets it to `''`. `reward_of` (reward.ts:85) accepts any `Number.isSafeInteger` `extra_id`. I reproduced both with a scratch test in a copy outside the checkout (SQLite, one ranked user on the daily board, `move_to` the next day). (a) Hook returns `{attachments: [{item_id: [rk_gold], amount: 1n}], extra_id: 0}`: the user gets 1 mail, the season is `Closed`, and there are 0 retry rows. The spec expects no mail, a retry row and `Retrying`. (b) Hook returns `{attachments: [], extra_id: 2 ** 31}`: `send_mail` logs `extra_id is not an int32`, the handling is `REJECTED`, `failed_count` is 1, there are 0 retry rows, and the season is `Closed`. The spec expects `FAILED` with a retry row | In `item_amount`, return null unless `big_amount` is a `string`. In `reward_of`, require `extra_id` to be an integer from −2^31 to 2^31 − 1. Add the ranking.md:319 test (an `Error` throw, a string throw, a missing `big_amount`), and add a test with an out-of-range `extra_id` | no | 95 |
| R3-2 | spec | medium | server/core/ranking/reward.ts:180 | open-game-works-core/skills/server-core/modules/ranking.md:175 and the error table now require an `error` log when a game transaction of job `ranking_season`, or of the reward handling of `close_season_now`, is `FAILED`. `storage` leaves no log for `FAILED` (storage.md error table). `game_tx` turns `FAILED` into `null`, and none of its callers log it: the lease take at reward.ts:320-322, the cursor and member writes at reward.ts:198/209 → reward.ts:270 and 243, the reward retry write at reward.ts:308, the guild member read at reward.ts:236, and retention at reward.ts:332. Reproduction in a scratch copy (SQLite): one user is ranked on the daily board, `storage.run_game_transaction` is replaced so its first call returns `'FAILED'`, and then `move_to` the next day. The job made 1 game transaction call, the season stayed un-closed, and `read_logs(error)` was `[]` | When `game_tx` gets `FAILED` and `stop()` has not started, leave an `error` log with `board_id` and `season` (through `report`). Keep the existing stop and next-season behavior. Add the ranking.md:340 test (`hold_db` on the `ranking_season` row) | no | 90 |
| R3-3 | spec | medium | server/core/ranking/dev/index.ts:32 | open-game-works-core/skills/server-core/modules/ranking.md:175 now requires the reward handling of `close_season_now` to leave an `error` log and end when the function of one of its game transactions, or one of its `storage.read_db` queries, throws. The `after_commit` function calls `read_season(storage.read_db(), …)` and `close_pass` with no catch. `storage.after_commit` discards the exception (storage.md:155), so no log is left. `run_season_job` catches this case only for the job (reward.ts:347-348). Reproduction in a scratch copy (SQLite): one user is ranked on the daily board, every `UPDATE ranking_season SET cursor_score` query throws `Error('boom')`, and then `testing.call_dev(close_season_now)` and `wait_background` run. `read_logs(error)` was `[]` | Wrap the `after_commit` body in try/catch and use the same `report` (an `error` log unless `stop()` has started), as `run_season_job` does. Together with R3-2, this also covers `FAILED` in that handling. Add the ranking.md:341 test | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The reproductions ran only with `OGW_DEFAULT_DB=sqlite`, in a copy of `server/`, `fixtures/`, `settings/`, `proto/`, `test-data/` and `core-spec/` outside the checkout. They used the `server/build/data` of the main checkout `open-game-works-core-impl/`. I did not run the PostgreSQL tests of ranking.md:340-341, because the target has no such tests
- The commit range changed no file under `server/core/ranking/`. The findings come from the definitions that `## spec changes` changed in ranking.md. For the mailbox, storage, item-ledger and logging changes in that diff, I checked only the parts that ranking calls: the `send_mail` `MailArg` form, the throw and `FAILED` rules of `run_user_transaction`, `run_game_transaction` and `read_db`, and `after_commit`. I found no other difference
- I did not run the server modules that depend on ranking, or the whole ranking suite
- The round 2 `## unknown` item is still not judged: `close_season` with no stop check for a missing board or `reward_mail` 0 (reward.ts:256-260, 282-286). ranking.md still does not say whether the stop rule covers these closes
