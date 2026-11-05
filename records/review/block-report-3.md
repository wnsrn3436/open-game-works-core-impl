# review block-report round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | `spec` | medium | server/core/block-report/index.ts:419 | The spec changes rewrite `BlockUser` step 4 (block-report.md `## behavior`): it reads the `user` rows of the `blocked_id` values of the user's block rows with one `storage.get_user_records`(`storage.db`(ctx), that list) call and deletes the rows with no element or a non-null `record.withdrawn_at`; `storage` now lists `block-report` in the `caller` of `get_user_records`. The new `## test` item says a `BlockUser` of a new target by a user with 3 block rows calls `storage.get_user_records` once with those 3 `blocked_id` values and calls `public-profile.is_active_user` with none of them. Code at HEAD 1b8ce0f (block-report code is unchanged in the range) still loops over `blocked_rows` (index.ts:419) and calls `profiles.is_active_user(ctx, row.blocked_id)` per row (index.ts:420); the module never references `get_user_records` (grep of server/core/block-report finds none), so that run makes 3 `is_active_user` calls and 0 `get_user_records` calls. No test in server/core/block-report/tests counts `get_user_records` or `is_active_user` calls (grep finds none), so the new `## test` item has no test | Replace the per-row `is_active_user` loop with one `storage.get_user_records(storage.db(ctx), blocked_ids)` call and delete the block rows whose ID has no element or a non-null `withdrawn_at`; add a test that spies both operations for a user with 3 block rows (one withdrawn) and asserts one `get_user_records` call with the 3 IDs, no `is_active_user` call with them, and the withdrawn row deleted | no | 95 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | The spec changes add "holds no U+0000" to `ref` and `evidence` (block-report.md `## API`) and the `## test` items for `ReportUser` (`ref` holding U+0000 is `INVALID_REQUEST`) and `add_report` (`evidence` or `ref` holding U+0000 is `INVALID_INPUT`, no report row). The code (index.ts:301, :304) now matches the definition, and tests report.test.ts:128 and :231 check both items; `ogw core test server block-report` passes at HEAD |
| R2-2 | open | index.ts:419-420 still calls `is_active_user` (one `get_user_record` query) per block row. The definition part is now settled by the spec changes (step 4 uses one `storage.get_user_records`), so the remaining fix is code only: R3-1 |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D3 | open | R2-2 | index.ts:419-420 calls `profiles.is_active_user` per block row of the caller in `BlockUser` of a new target; block-report code is unchanged in the range. The code now also differs from the changed `BlockUser` step 4 (R3-1) |

## must fix

none

## unknown

- `ogw core test server block-report` was run once at HEAD 1b8ce0f and passed; no mutation run was needed this round because R2-1 was judged on the spec text and the tests already confirmed in round 2, and no `test evidence` finding was answered.
- The storage changes of the range (abort handling, `read_db` retry and throw, U+0000 failing on SQLite) were read only where they reach block-report: block-report uses no `read_db` handle and catches no storage throw, and its U+0000 check runs before any write. The storage module itself was not reviewed.
- The doc comment at index.ts:292-294 says SQLite stores U+0000, which the storage changes make untrue; it is a `low` comment mismatch and not written.
- Whether `chat` can pass an `evidence` holding U+0000 to `add_report` was not checked in `chat` (outside this target).
- The other changes in the commit range (logging, public-profile distinct IDs, and other modules) were checked only for their effect on block-report: `GetBlockedUsers` passes distinct `blocked_id` values to `get_public_profiles`, so the distinct-ID change does not alter its result.
