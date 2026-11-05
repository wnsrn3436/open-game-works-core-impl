# review block-report round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `BlockUser` step 4 now builds `blocked_ids` from `blocked_rows` (server/core/block-report/index.ts:418), reads them with one `storage.get_user_records(db, blocked_ids)` call (index.ts:419) and deletes the rows whose ID is not in the set of elements with `record.withdrawn_at === null` (index.ts:421-424), which matches block-report.md `## behavior` step 4; `get_user_records` is in `BlockReportStorage` and the required storage methods (index.ts:22, :251). Test server/core/block-report/tests/block.test.ts:90 spies both operations for a user with 3 block rows (active, withdrawn, no `user` row) and checks one `get_user_records` call with those 3 IDs, `is_active_user` called only with the new target, and the withdrawn and missing rows deleted. Restoring the defect: in a temporary `git worktree` of HEAD 1faaa54 outside the checkout, index.ts:418-424 was replaced with the round-3 loop (`for (const row of blocked_rows(db, ctx.user_id)) { if (profiles.is_active_user(ctx, row.blocked_id)) kept += 1; else db.query(DELETE ...) }`) and block.test.ts was run with vitest (SQLite): that test failed at block.test.ts:111 (`expected [] to deeply equal [[9000000000n, …]]`), the other 17 passed. `ogw core test server block-report` passes at HEAD |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D3 | fixed | none | `BlockUser` of a new target makes one `storage.get_user_records` query for all block rows (index.ts:419) and no `is_active_user` call per block row (only the target's at index.ts:415); block.test.ts:90-112 checks the call counts |

## must fix

none

## unknown

- The mutation run used vitest directly in the temporary worktree with `OGW_DEFAULT_DB=sqlite` and the server build data folder of the main core checkout (`ogw core test` resolves a checkout outside `worktrees/_core/` to the main core checkout, so it cannot run a temporary copy); the PostgreSQL run of the mutated code was not made. The HEAD run of `ogw core test server block-report` covers both DBs.
- The block-report spec has a `## test` item for this behavior only with 3 block rows; a run near `block-report.maxBlocks` large values (the settings schema sets no maximum) was not measured. `storage.get_user_records` splits large ID lists (storage.md `## test` 70000 IDs), so it is not checked further here.
- The other changes of the commit range (public-profile one `get_user_records` per chunk, admin-api, mission, client modules) were read only for their effect on block-report: `GetBlockedUsers` gets the same profiles and order from the changed `get_public_profiles` (ascending IDs per chunk, withdrawn and missing users left out). Those modules were not reviewed.
