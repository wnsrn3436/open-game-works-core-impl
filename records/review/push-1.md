# review push round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | server/core/push/send.ts:522 | `send_held_batch` takes `now` once (send.ts:496) and selects due rows with `send_at <= $1 AND expires_at > $1` (send.ts:497-500). Each row is then taken in its own game transaction by `DELETE FROM push_held WHERE push_id = $1 AND user_id = $2 RETURNING push_id` (send.ts:521-523), which has no expiry condition, and every taken row is sent at send.ts:527. Run path: a row with `expires_at` = T+1 is selected at `clock_now` T; the takes of the earlier rows of the batch (up to `push.sendBatchSize` game transactions) and `drop_held` run one after another, so `clock_now` reaches T+1 before this row's take; the delete still matches and the push is sent after `expires_at`. `storage` `### expiry` says a row with expiry column ≤ `clock_now` counts as a row that does not exist also before it is deleted, and `push` `### send` sends only when a row was deleted. Same as input D1; the code is unchanged | Add `AND expires_at > $3` with `core.time.clock_now()` read inside the take transaction to the take delete (or delete expired rows without sending), and add a test that advances the clock past `expires_at` between the select and the take and asserts no send | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | The take delete at server/core/push/send.ts:522 still has no `expires_at` condition and `now` is still taken once at send.ts:496 before the takes; the commit range is empty, so the code is the same as when D1 was written |

## must fix

none

## unknown

- The commit range 48941ff..48941ff is empty, so no changed code was reviewed; only the D1 position (send_held_batch, drop_held, held_sending, send_one_held in server/core/push/send.ts) and the push, storage specs it refers to were read
- No test was run to reproduce R1-1; the run path is from reading the code
