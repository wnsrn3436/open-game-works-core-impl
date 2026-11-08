# review: nickname round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit d7430b85 sets `"minimum": 1` for `admin-api.maxSearchRows` in `settings/core-settings.schema.json:75` and `server/generated/core_settings_schema.json:75`, which matches "1 or more" of nickname.md:161 and admin-api.md:289. `broken_number_keyword` (`server/core/routing/settings_check.ts:74`) now returns `minimum` for 0. Added test `server/core/nickname/tests/admin.test.ts:199` passes (`ogw core test server nickname`: pass on SQLite and PostgreSQL). Restored the defect in a `git worktree add` worktree of HEAD by setting both schema minimums back to 0: the same test failed on SQLite and PostgreSQL with `expected null to be an instance of StartFailure` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | `settings/core-settings.schema.json:75` and `server/generated/core_settings_schema.json:75` now have `"minimum": 1`, so the server start settings check rejects `admin-api.maxSearchRows: 0` (test `server/core/nickname/tests/admin.test.ts:199`), and `LOOKUP` with `LIMIT 0` cannot be reached through settings |

## must fix

none

## unknown

- The other changes of the range (`client/godot/core/game_update_core/`, `server/core/idempotency/tests/`, `records/`) do not touch nickname code or code that nickname calls; they were read only to confirm that
- The admin-api side of D1 (the `limit` check of admin-api.md:177 with a maximum of 0) belongs to the admin-api target and was not tested here; the schema change stops that value at server start for both modules
- Only the nickname core tests were run; the core tests of the modules that depend on nickname were not run (`ogw review run` runs them)
