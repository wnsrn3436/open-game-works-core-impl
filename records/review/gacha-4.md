# review: gacha round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `server/core/gacha/records.ts:33-36` now takes `MAX(draw_seq)` only over the user's rows with `expires_at > $13`, and `$13` is `time.clock_now()` (`server/core/gacha/index.ts:326`, passed through `insert_record` at `server/core/gacha/records.ts:163-177`). The insert is an upsert `ON CONFLICT (user_id, draw_seq) DO UPDATE` that sets every column outside the key (`UPSERT_SET`, `server/core/gacha/records.ts:29`, built from `COLUMNS`), the same pattern as `item-ledger` `insert_history`. This matches `storage` `### expiry` and `gacha` `### draw record`. Test evidence: in a `git archive` copy of HEAD e64623c in the scratchpad, `server/core/gacha/records.ts` and `server/core/gacha/index.ts` were put back to their ab75c82 contents (the defect), and the new test `server/core/gacha/tests/history.test.ts:76` was kept. That test fails on SQLite at `history.test.ts:91` with `[[2n, 1800000060000n]]` against the expected `[[1n, 1800000060000n]]`, and fails the same way on PostgreSQL 18.6. In an unmodified copy of HEAD the whole gacha suite (5 files, 43 tests) passes on both SQLite and PostgreSQL |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D9 | fixed | none | The fix of R3-1 removes it: `draw_seq` comes from the user's live rows only (`server/core/gacha/records.ts:35`), and an expired row with that key that the sweep has not deleted yet is written over (`records.ts:36`). The D9 probe is now the test `server/core/gacha/tests/history.test.ts:76`. It gives `draw_seq` 1, and leaves only that one row in the table, on both SQLite and PostgreSQL |

## must fix

none

## unknown

- The tests were run with the vitest that ogw pins (`open-game-works-core/tools/node_modules/vitest`) and with a vitest config made to match `vitestTestOptions` (globals, forks), not through `ogw core test`. The built data was `open-game-works-core-impl/server/build/data`. PostgreSQL ran in a throwaway `postgres:18.6` container with the image digest from harness settings `tools.postgresql`, started the way `startPostgres` starts it.
- The tests of modules that depend on gacha were not run. `ogw review run` runs them after each fix.
- Other changes in the range (`server/core/auth/tests/social.test.ts`, `settings/core-settings.schema.json` `auth.socialVerifyTimeoutMs`, records) are outside gacha and were not reviewed.
- No concurrent probe was made of an upsert that meets a row that `sweep_expired` is deleting at the same time on PostgreSQL. `storage` owns that behavior (storage.md:460), and it is not part of this target.
