# review fix: gacha round 3

## done

- `gacha` (server): `draw_seq` of a new draw record is now the largest `draw_seq` of the user's rows with `expires_at > server-time.clock_now`, plus 1, or 1 when there are none. The insert is an upsert (`ON CONFLICT (user_id, draw_seq) DO UPDATE` sets every non-key column), so when the new key meets an expired row that the sweep has not deleted yet, the new row replaces it. This is the same pattern as `item-ledger` `insert_history`. `insert_record` takes `now`, and `save_draws` passes `time.clock_now()` (`server/core/gacha/records.ts:28-36`, `server/core/gacha/index.ts:325-340`)
- `ogw core test server gacha routing testing`: all pass. `ogw code check core`: type check, lint, dependency and secret all pass
- No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written

## spec proposals

none

## review

- R3-1: fixed. `server/core/gacha/records.ts:28-36` (MAX now only counts rows with `expires_at > $13` (`now`), and the insert is now an upsert over the key), `server/core/gacha/records.ts:163` (`insert_record(db, record, now)`), `server/core/gacha/index.ts:326` (passes `time.clock_now()`). Added test: `server/core/gacha/tests/history.test.ts:76`, "draw_seq counts only rows that have not expired: …". It uses `gacha.historyRetentionMs` 60000 and `routing.storageSweepIntervalMs` 3600000. It draws once, advances the clock 60000 and checks that the expired row is still stored, then draws again. It expects `ListGachaHistory` to return only `[1n, START_AT + 60000]` and the table to hold only that row, because the expired row was written over
- D9: closed by the R3-1 fix

## unverified

- I did not run the added test against the code before the fix. The `fix test proof` of the review checks that. I expect it to fail there, because the old insert gives `draw_seq` 2 and keeps the expired row, which matches the reviewer's probe
- I did not check whether `ogw core test server` ran the module tests on PostgreSQL as well as SQLite (the output lists each module twice). The statement is the same on both, and `ON CONFLICT … DO UPDATE … RETURNING` is supported by both SQLite 3.35+ and PostgreSQL
