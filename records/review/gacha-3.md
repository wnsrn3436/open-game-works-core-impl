# review: gacha round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | server/core/gacha/records.ts:32 | `INSERT` takes `draw_seq` as `(SELECT COALESCE(MAX(draw_seq), 0) + 1 FROM gacha_draw_record WHERE user_id = $1)`, with no `expires_at > clock_now` condition, and the comment at `records.ts:28-29` says expired rows that are not swept yet still count. `storage` `### expiry` (storage.md:269) says a row with expiry column ≤ `clock_now` counts as a row that does not exist even before it is deleted, and `gacha` `### draw record` (gacha.md:122) gives `draw_seq` from the largest value among that user's draw records + 1, or 1 when there are none. Probe in a temporary copy of HEAD ab75c82 (SQLite, vitest pinned by ogw): `gacha.historyRetentionMs` 60000, `routing.storageSweepIntervalMs` 3600000, one `DrawGacha` on `[gacha_banner_main]`, `advance_time` 60000, `wait_background`, a second `DrawGacha`. `ListGachaHistory` (banner 0, cursor 0) then returns `[2n]` where the documents give `[1n]`. So `draw_seq` depends on when the sweep runs. This is input debt D9 | Take the MAX only over the user's rows with `expires_at > clock_now`, and make the insert an upsert (`ON CONFLICT (user_id, draw_seq) DO UPDATE` setting every non-key column) so that a new key that meets an expired, unswept row replaces it, as `item-ledger` `insert_history` does (`server/core/item-ledger/history.ts:108-109`). Add a test that draws again after the retention period with no sweep between and expects `draw_seq` 1 | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D9 | open | R3-1 | `server/core/gacha/records.ts:32` has not changed since round 2 (no commit touches `server/core/gacha` after ad44152). The probe in R3-1 still gives `draw_seq` 2 for the only live row, where the documents give 1 |

## must fix

none

## unknown

- The commit range is empty (ab75c82..ab75c82), so no code changes were reviewed. Round 2 had no findings, so `## previous` has no rows to judge. The only item in scope was D9.
- The D9 probe ran only on SQLite (`OGW_DEFAULT_DB=sqlite`), in a `git archive` copy of HEAD in the scratchpad, with the built data of `open-game-works-core-impl/server/build/data` (test-data and proto are the same as ab75c82). PostgreSQL was not run. Both DBs use the same insert statement.
- The rest of the gacha suite and the modules that depend on gacha were not run in this round.
