# review: item-ledger round 1

## findings

none

## previous

none

## out of scope

- server/core/item-ledger/history.ts:104: medium `insert_history` gives `seq` as `MAX(seq) + 1` over every history row of the user, expired rows included. `storage` `### expiry` says a row with expiry column ≤ `clock_now` counts as a row that does not exist, also before it is deleted, and item-ledger `### storage and client delivery` says `seq` starts from the largest value among that user's history rows + 1, or from 1 when there are none. Run path: `add_items` at t0 (history seq 1), advance past `item-ledger.historyRetentionMs`, then `add_items` again before `sweep_expired` runs. The new row gets seq 2, but the defining documents give seq 1. After a sweep the same call gives seq 1, which `server/core/item-ledger/tests/history.test.ts:58` checks, so `seq` depends on when the sweep ran. If `MAX` only counted unexpired rows, a plain INSERT would hit the primary key `(user_id, seq)` of an expired row that has not been swept yet. A fix that keeps the documents is `MAX(seq)` over unexpired rows plus an upsert over the expired row with the same key, which is the storage upsert rule. This code is not changed in the range and the sweep batching does not change this behavior.

## debt

none

## must fix

none

## unknown

- The only change under `server/core/item-ledger/` in the commit range is `server/core/item-ledger/tests/history.test.ts:55`. It now reads `.deleted` from the `SweepResult` that `storage.sweep_expired` returns (`server/core/storage/rows.ts:385`, `server/core/storage/index.ts:190`). This matches the `storage` API row "number of deleted rows and failed table list".
- I checked how item-ledger depends on the storage changes in the range:
  - Batched sweep (`server/core/storage/rows.ts:385-407`): the outer expiry condition keeps a `once_key` row that `put_once_key` (`server/core/item-ledger/history.ts:140`) rewrote by upsert after the inner select. `has_once_key` and `select_history` filter `expires_at > now`, so rows that a batch leaves until a later run still count as absent.
  - Automatic expiry index (`server/core/storage/schema.ts:191`): both item-ledger tables (`server/core/item-ledger/history.ts:44-45`) now also get the index `(expires_at)`. `history.test.ts:38-39` checks only that the `(user_id, time)` index exists, so the extra index does not break it. `apply_schema` adds the new index to an existing table (`server/core/storage/schema.ts:310-311`).
  - New `NO_FREE_CONNECTION` lock code (`server/core/storage/db/postgres.ts:19`): item-ledger does not read DB error codes.
- I did not get item-ledger tests to pass. I ran `vitest run` on `server/core/item-ledger/tests` with the harness options (globals, forks). All 14 files stopped before their tests: "testing: the server build data folder null does not exist" (`OGW_SERVER_DATA` is not set). The PostgreSQL concurrency test also stopped: "DB kind postgresql needs OGW_POSTGRESQL". These inputs come from `ogw core test`, which I did not run.
- I did not re-review item-ledger code outside the range and outside the paths the storage changes reach, because `## spec changes` is `none`.
