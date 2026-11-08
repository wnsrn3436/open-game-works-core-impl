# review: nickname round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | settings/core-settings.schema.json:73 | Input debt D1. `admin-api.maxSearchRows` has `"minimum": 0` (same in the generated `server/generated/core_settings_schema.json:73`), while `## settings` of the nickname spec and of the admin-api spec (admin-api.md:289) say "1 or more". The server start settings check compares only against the schema (`server/core/routing/settings_check.ts:75`: `value < property.minimum`), so the value 0 passes it, and `create_nickname` only checks that the value is an integer (`server/core/nickname/index.ts:79-83`, `:121`). Run path: game settings `admin-api.maxSearchRows: 0` → server starts → `find_user_by_nickname` handler (`server/core/nickname/index.ts:357`) calls `lookup(..., 0)` → `LOOKUP` with `LIMIT 0` (`server/core/nickname/index.ts:73`) → `users` is empty for every nickname, also one that a user holds | Set `"minimum": 1` for `admin-api.maxSearchRows` in `settings/core-settings.schema.json` and regenerate `server/generated/core_settings_schema.json`, so the settings check rejects 0 at server start; add a test that server start fails with `admin-api.maxSearchRows: 0` | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `settings/core-settings.schema.json:73` and `server/generated/core_settings_schema.json:73` still have `"minimum": 0` for `admin-api.maxSearchRows`; the settings check (`server/core/routing/settings_check.ts:75`) and `create_nickname` (`server/core/nickname/index.ts:121`) accept 0 |

## must fix

none

## unknown

- The commit range `3c42c58d..3c42c58d` is empty, so no change was reviewed; only the input `## debt` item D1 was checked, by reading the schema, the settings check and the nickname code
- The run path of R1-1 (server start with `admin-api.maxSearchRows: 0`, then `find_user_by_nickname`) was traced by reading code, not by a run
- The admin-api side of D1 (every query with `limit` rejected when the maximum is 0) belongs to the admin-api target and was not checked here
