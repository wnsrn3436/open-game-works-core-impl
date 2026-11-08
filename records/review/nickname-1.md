# review: nickname round 1

## findings

none

## previous

none

## out of scope

- settings/core-settings.schema.json:73: medium `admin-api.maxSearchRows` has `"minimum": 0` (also in the generated `server/generated/core_settings_schema.json:73`), while `## settings` of the nickname spec (nickname.md:161) and of the admin-api spec (admin-api.md:289) say "1 or more". The settings check of server start added in this range (routing.md:80, `server/core/routing/settings_check.ts`) is now the one check of settings values and a module does not check them again, so a value 0 passes server start; then `find_user_by_nickname` runs `LOOKUP` with `LIMIT 0` (`server/core/nickname/index.ts:316`) and returns an empty `users` list for every nickname, and every admin-api query with `limit` (at least 1 and at most `admin-api.maxSearchRows`, admin-api.md:177) is rejected. The schema value predates the range and belongs to admin-api

## debt

none

## must fix

none

## unknown

- `server/core/nickname/` has no change in the commit range. The changes in the range that nickname reaches were read: `storage` (DB meter wrapping of the SQLite and PostgreSQL adapters, the seed provider call moved before ctx creation, `make_seed`, `watch_db_wait`, `read_db_metrics`), `item-ledger` (history `seq` counter table and plain insert, `onceKeyRetentionMs`), which `SetNickname` step 4 reaches through `subtract_items`, `logging` (metrics on every written line), which the banned word `info` log reaches, and `routing` (settings check at `create_server`, step 7 `min_version`, `ServerError.detail` text, real-clock `duration_ms`, server process with request workers). No problem caused or revealed in nickname was found in them
- `ogw core test server nickname` ended `pass` (job mw7wof8q0baf39). Whether that result was run anew or taken from the result cache, and whether it covered PostgreSQL as well as SQLite, was not checked
- The server process with several request workers (`server/core/routing/server_process.ts`) was not run with nickname: the concurrent `nickname_claim` lock across worker threads on one DB was checked only by reading `storage.lock_game_row` use in `server/core/nickname/index.ts:196`, not by a run
