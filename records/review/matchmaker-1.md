# review matchmaker round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range cf89b7f..4508d5f changes no file under `server/core/matchmaker/`. The server code it changes that matchmaker reaches is `storage`: `sweep_expired` (`server/core/storage/rows.ts:384`) now deletes in batches, each batch in its own transaction, and returns a failed table list; `table_def` (`server/core/storage/schema.ts:191`) adds an index of the expiry column alone; `create_index_sql` uses `IF NOT EXISTS`; and the PostgreSQL wait for a free connection has code `POOL` (`server/core/storage/db/pg_messages.ts:53`). These were checked against the matchmaker code that reaches them:
  - Both matchmaker tables are registered with expiry column `expires_at` (`server/core/matchmaker/records.ts:189`), so each now also gets the index `(expires_at)`. This equals `storage` `register_table` (an index of the expiry column is added when no index starts with it). The `matchmaker` spec table definition lists only the indexes of its own queries, so this is not a difference. Existing tables get the new index through the added-index path of `apply_schema` (`server/core/storage/schema.ts:310`)
  - A sweep can now leave a match deleted from one of the two tables and not yet the other (per-table batches and the per-table time budget). `read_record` (`server/core/matchmaker/records.ts:274`) returns null when the match row is missing or expired or when there is no participant row, and `write_apply_state` writes the same `expires_at` to both tables in one transaction, so a partly deleted record reads as none (`MATCH_NOT_FOUND`), as the `storage` `### expiry` rules require. The `matchmaker_sweep` queries `DUE_DEADLINES` and `DUE_APPLIES` (`server/core/matchmaker/records.ts:207`) select only rows with `status` `PENDING` or non-null `next_apply_at`, and a row with `expires_at` set has neither
  - The `POOL` code is in `LOCK_CODES` (`server/core/storage/db/postgres.ts:19`) as `55P03` was before, so it is still a lock `DbError`; matchmaker does not tell lock failures from other failures (`lock_game_row` and `run_game_transaction` results are only compared with `FAILED`), so its handling is unchanged
- The matchmaker code outside the range was not reviewed, because a problem that existed before the range and is unrelated to the changes is not a finding of this round
- Input `## spec changes` is `none`, so no spec diff was checked against the matchmaker code
- The matchmaker tests (`server/core/matchmaker/tests/`) were not run: this checkout has no installed test runner (no `node_modules`). The changed paths above were checked only by reading
