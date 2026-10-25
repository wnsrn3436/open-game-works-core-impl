# review: game-update round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range 2ef5ae8d..3a98bb0 changes no file of `server/core/game-update/` (code, `dev/`, `tests/`) and no `game-update.*` settings key. The changes in range that reach code near the target were checked and do not affect it: `server/core/game-update/deps.ts:17` uses only `storage` operations `register_table`, `run_game_transaction`, `lock_game_row`, `after_commit`, `db`, `read_db`, and the range changes none of them (`server/core/storage/index.ts` changes `create_user` to return `NewUser` and adds `find_user_by_public_code`, `is_public_code_input` and `public_code` of `get_user_record`; `server/core/storage/schema.ts` adds core schema version 2 and `fill_public_codes` after the module tables in `apply_schema`, which touches only the `user` table and not `game_update_file`, `game_update_deploy_list` or `game_update_cdn_upload`). `server/core/routing/pipeline.ts:588` adds `public_code` to the step 6 ban detail and leaves the step 7 version check that calls `game_update.is_data_update_ready` (`server/core/routing/pipeline.ts:593`) and its order unchanged. `server/core/routing/module_api.ts:97` adds `get_user_record` to `StorageModule`, which game-update does not use. `settings/core-settings.json` and its schema add only `SoundCore.*` and `public-profile.findPerMinute`. The test support that `server/core/game-update/tests/helpers.ts:17` imports from `server/core/storage/tests/helpers.ts` (`core_settings`, `new_db`, `stop_all`, `test_server`, `TestClock`) is unchanged; the range changes only `new_user` and adds `new_users`, which game-update tests do not import. `core-spec/storage.json` adds only the two new operations. So no change of that range causes or reveals a problem in the target, and the game-update code outside the range was not reviewed in this round
- The game-update tests were not run in this round: this checkout has no installed `server/node_modules` and `server/package.json` has no test script. That they still pass against core schema version 2 rests on reading the code
