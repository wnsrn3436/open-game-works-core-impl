# review item-ledger round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/item-ledger/history.ts:104 | `insert_history` gives `seq` as `(SELECT COALESCE(MAX(seq), 0) + 1 FROM item_ledger_history WHERE user_id = $1)` with no `expires_at > clock_now` condition, so expired rows not yet deleted by `sweep_expired` count. storage `### expiry` says a row with expiry column ≤ `clock_now` counts as a row that does not exist also before it is deleted, and item-ledger `### storage and client delivery` says `seq` starts from the largest value among that user's history rows + 1, or 1 when there are none. Run path: `add_items` at t0 (history seq 1), `advance_time` by `item-ledger.historyRetentionMs`, `add_items` again without calling `sweep_expired`: the new row gets seq 2 while the documents give seq 1. With `sweep_expired` called first the same call gives seq 1 (server/core/item-ledger/tests/history.test.ts:58), so `seq` depends on sweep timing. Code unchanged since the debt item was written (only commit touching the file is 301b3dd) | Take `MAX(seq)` only over rows with `expires_at > clock_now` and write the row with an upsert `ON CONFLICT (user_id, seq) DO UPDATE` that overwrites every column of an expired row with the same key (storage upsert rule, as `put_once_key` does); add a test that adds again past the retention before the sweep and expects seq 1 and only the new row in `list_history` | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | server/core/item-ledger/history.ts:104 still computes `MAX(seq)` over every history row of the user, expired rows included; the commit range is empty and the file has no change since 301b3dd |

## must fix

none

## unknown

- The commit range c1c9496..c1c9496 is empty, so no changed code was reviewed; only the D1 position (server/core/item-ledger/history.ts and server/core/item-ledger/tests/history.test.ts) was read
- R1-1 was confirmed by reading the SQL and the test; it was not reproduced by running a new test, because the review does not write files outside `output`
