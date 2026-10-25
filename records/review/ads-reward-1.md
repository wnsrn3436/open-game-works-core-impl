# review: ads-reward round 1

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

- The commit range 2ef5ae8d..b99875f changes no file under `server/core/ads-reward/`. The changes that reach this module were checked: `storage` user IDs are now secure random below 2^53 (`server/core/storage/public_code.ts:16`, `server/core/storage/rows.ts:57`) and `create_user` returns `NewUser`; `routing` `StorageModule` gained `get_user_record` (`server/core/routing/module_api.ts:97`); `routing` `REQUEST_PREPARE` gained `core/FindUserByPublicCode` (`server/core/routing/spec_tables.ts:69`). ads-reward does not call `create_user`, `get_user_record` or `StorageModule`. Callback user ID validation (`server/core/ads-reward/adapter.ts:73`) accepts 1 to 2^63−1, which holds all new user IDs. The ads-reward tests build callback queries from `session.user_id` and do not depend on user ID values or the order users were made (`server/core/ads-reward/tests/helpers.ts:198`, `server/core/ads-reward/tests/grant.test.ts:92`)
- The ads-reward tests were not run: this worktree has no installed `node_modules`, and tests run through `ogw core test`
- The rest of the module, which the range does not change or reach, was not reviewed as a whole. Client `AdCore` (which passes the user ID to the ads SDK) is outside this server module target and was not reviewed
