# review push round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/push/send.ts:522-527: the take is now `DELETE FROM push_held WHERE push_id = $1 AND user_id = $2 AND expires_at > $3 RETURNING push_id` with `core.time.clock_now()` read inside the take's game transaction, so a row that reached `expires_at` after the batch select is not taken and not sent (`push` `### send`, `storage` `### expiry`). Test server/core/push/tests/send.test.ts:202 moves the clock to `expires_at` before the first row's take statement (helper `before_statements`, server/core/push/tests/helpers.ts:435) and asserts the second row is not sent and `sent_count` is 1. Restored the defect in a temporary copy of the checkout outside the worktree (removed `AND expires_at > $3` and the third parameter from the take at send.ts:524-525) and ran that test alone on SQLite: it failed at server/core/push/tests/send.test.ts:224 (`expected [ { …(2) } ] to deeply equal []`, the expired row was sent); with the fix the same test passes |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | The take delete at server/core/push/send.ts:524 now has `expires_at > $3` with `clock_now` read in the take transaction; the restored-defect run of server/core/push/tests/send.test.ts:202 failed and the fixed code passes it (see R1-1) |

## must fix

none

## unknown

- Of the commit range, only the changes under server/core/push/ (send.ts, tests/helpers.ts, tests/send.test.ts) are in the target; the other changed files belong to other modules and were not reviewed
- The restored-defect run and the fixed run were made only with `OGW_DEFAULT_DB` `sqlite`, for the one test at server/core/push/tests/send.test.ts:202; the PostgreSQL run and the rest of the push suite were not run
- `drop_held` (server/core/push/send.ts:546-561) still deletes every `push_held` row of a record without an expiry condition; it sends nothing and the code did not change in the range, and whether deleting only expired rows should end a `SENDING` record `FAILED` was not checked against the spec
