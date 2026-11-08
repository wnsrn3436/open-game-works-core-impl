# review game-update round 1

## findings

none

## previous

none

## out of scope

- server/core/matchmaker/realtime.ts:382: medium `HELLO` handling runs only `data_version_error(frame.data_version, frame.client_version)` (server/core/matchmaker/realtime.ts:342-348), which never calls `game-update.is_below_min_version`, and the matchmaker reads neither a `platform` field of the frame nor that operation (`grep platform server/core/matchmaker/*.ts` finds nothing; server/core/matchmaker/index.ts:118 binds only `is_data_update_ready`). The matchmaker spec `HELLO` handling (skills/server-core/modules/matchmaker.md:114) and its `## test` item (matchmaker.md:399) require `CLOSE`(`APP_UPDATE_REQUIRED`) for `client_version` `1.1.9` and `platform` `android` under a deploy list with android `min_version` `1.2.0`, and `CLOSE`(`INVALID_REQUEST`) for a non-empty `platform` that `validation.is_platform` rejects; with this code that `HELLO` gets `HELLO_ACK`. game-update.md lists `matchmaker` as a caller of `is_below_min_version`

## debt

none

## must fix

none

## unknown

- Checked: the commits 06103b5d and ad3660ee, the only ones of the range that touch server/core/game-update (cache.ts, deploy_list.ts, deps.ts, index.ts, tests/helpers.ts, tests/min-version.test.ts), against `### minimum app version`, `## API` and `## test` of game-update.md and `parse_version` / `compare_versions` of validation.md; the production wiring of the `validation` module input (server/core/routing/spec_tables.ts:25 dependency list, server/core/routing/server.ts create_modules); the routing caller server/core/routing/pipeline.ts:632. `ogw core test server game-update` passed
- Not checked: the routing step 7 behavior and tests (server/core/routing/pipeline.ts, server/core/routing/tests/min-version.test.ts) beyond the call into game-update, as they belong to the `routing` target
- Not checked: the other changes of the range outside server/core/game-update (other modules), as they do not call or get called by the changed game-update code except the callers named above
