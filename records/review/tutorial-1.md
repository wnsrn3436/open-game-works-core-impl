# review: tutorial round 1

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

- The range 2ef5ae8d..5c34b66 changes no file of `server/core/tutorial/` and no tutorial part of the contract (`proto/ogw/core.proto` adds only public code fields and `FindUserByPublicCode`). The changes the tutorial code calls or depends on were read: `storage` `create_user` (now random user IDs below 2^53 and a public code, `server/core/storage/rows.ts:57`), `get_user_record`, core schema version 2 with the start fill (`server/core/storage/schema.ts:217`, `server/core/storage/schema.ts:317`), and the `routing` ban detail (`server/core/routing/pipeline.ts:588`). `tutorial` calls only `get_state`, `put_core_state`, `delete_core_state`, `logging.write` and `logging.track_core_event` (`server/core/tutorial/index.ts:10`), none of which changed; the tutorial tests do not call `create_user` and compare user IDs only as bigint or string (`server/core/tutorial/tests/progress.test.ts:84`, `server/core/tutorial/tests/analytics.test.ts:19`), so the random user IDs do not change their results
- The tutorial core tests were not run: a run needs `npm ci` in `server/` of this checkout, which writes files outside `output`. Whether they pass after the range is judged only by reading the code
