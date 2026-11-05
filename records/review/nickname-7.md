# review nickname round 7

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R6-1 | fixed | server/core/nickname/tests/set-nickname.test.ts:3 and server/core/nickname/tests/admin.test.ts:2 now import `game_row_lock_id` from `../../testing/dev/index.ts`, and the `../../storage/tx.ts` import is gone from every file under server/core/nickname/tests (grep of the imports). The lock keys at set-nickname.test.ts:58, :90 and admin.test.ts:63 are `game_row_lock_id('nickname_claim', [normalize_text(...)])`. server/core/testing/dev/database.ts:149 computes it as `row_lock_key(..., table, key)`, which for a table other than `game_state` is `lock_key(table, key)` (server/core/storage/tx.ts:387-390), the same key `storage.lock_game_row` takes at server/core/nickname/index.ts:202 for `CLAIM_TABLE` `nickname_claim` (index.ts:66). The `validation/text.ts` import is also gone: the tests use `h.core().validation.normalize_text`, which is `normalizeText` (server/core/validation/index.ts:80). This is a `structure` finding, so no defect restore applies. `ogw core test server nickname` passed in this round |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D6 | fixed | none | Same as R6-1: neither server/core/nickname/tests/set-nickname.test.ts nor server/core/nickname/tests/admin.test.ts imports `lock_key` from `../../storage/tx.ts`. Both use `game_row_lock_id` of `testing` (set-nickname.test.ts:3,58,90, admin.test.ts:2,63) |

## must fix

none

## unknown

- The commit range f58b503..07d238f changes nickname only in server/core/nickname/tests/admin.test.ts, helpers.ts and set-nickname.test.ts. The range's other changes (routing, public-profile, RealtimeCore, records) are outside the nickname target and were not reviewed.
- The admin.test.ts change at line 145 expects 400 for `find_user_by_nickname` input that holds U+0000. That follows the admin-api string rule (open-game-works-core/skills/server-core/modules/admin-api.md:179), which nickname.md:50 defers to. The same U+0000 and lone-surrogate inputs still give an empty list through `find_user_ids_by_nickname` at server/core/nickname/tests/lookup.test.ts:66. The admin-api implementation of that 400 is outside this target and was not reviewed.
- server/core/nickname/tests/helpers.ts:8 imports `storage_module` from `../../storage/tests/helpers.ts`. This dates from 301b3dd and is allowed, because server-core/SKILL.md:28 lets a core test in `tests/` import files of the modules it needs (the internal-file rule of SKILL.md:30 is for files outside `tests/`). It is not written as a problem.
- `ogw core test server nickname` passed (job mw3q4dtwa4a0d9). The modules that depend on nickname were not run in this round.
